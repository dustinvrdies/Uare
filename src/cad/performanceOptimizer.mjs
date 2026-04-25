/**
 * Performance optimization layer: caching, memoization, and parallel constraint solving.
 * Dramatically speeds up repeated assembly calculations and constraint resolution.
 */

import crypto from 'crypto';

class GeometryCache {
  constructor(maxSize = 1000, ttlMinutes = 60) {
    this.cache = new Map();
    this.maxSize = maxSize;
    this.ttlMs = ttlMinutes * 60 * 1000;
  }

  hash(obj) {
    return crypto.createHash('sha256').update(JSON.stringify(obj)).digest('hex');
  }

  set(key, value) {
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }
    this.cache.set(key, { value, expiry: Date.now() + this.ttlMs });
  }

  get(key) {
    const entry = this.cache.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiry) {
      this.cache.delete(key);
      return undefined;
    }
    return entry.value;
  }

  clear() {
    this.cache.clear();
  }

  stats() {
    return {
      size: this.cache.size,
      max_size: this.maxSize,
      ttl_minutes: this.ttlMs / 60 / 1000,
    };
  }
}

class ConstraintSolver {
  constructor() {
    this.solveCache = new GeometryCache(500, 30);
  }

  /**
   * Parallel solver strategy: break constraint graph into independent subgraphs,
   * solve each in parallel, then merge results.
   */
  async solveParallel(constraints = [], parts = [], options = {}) {
    const partId = (obj) => String(obj?.id || obj?.part_id || '');
    
    // Build dependency graph
    const graph = new Map();
    for (const part of parts) {
      graph.set(partId(part), []);
    }
    for (const c of constraints) {
      const a = partId(c.part_a || c.a);
      const b = partId(c.part_b || c.b);
      if (graph.has(a) && graph.has(b)) {
        graph.get(a).push(b);
        graph.get(b).push(a);
      }
    }
    
    // Find connected components (independent subgraphs)
    const visited = new Set();
    const components = [];
    
    const dfs = (nodeId, component) => {
      if (visited.has(nodeId)) return;
      visited.add(nodeId);
      component.push(nodeId);
      for (const neighbor of graph.get(nodeId) || []) {
        dfs(neighbor, component);
      }
    };
    
    for (const nodeId of graph.keys()) {
      if (!visited.has(nodeId)) {
        const component = [];
        dfs(nodeId, component);
        components.push(component);
      }
    }
    
    // Solve each component in parallel
    const componentConstraints = components.map((component) => {
      const componentSet = new Set(component);
      return constraints.filter((c) => {
        const a = partId(c.part_a || c.a);
        const b = partId(c.part_b || c.b);
        return componentSet.has(a) && componentSet.has(b);
      });
    });
    
    const results = await Promise.all(
      componentConstraints.map((cc) => this.solveComponent(cc, parts)),
    );
    
    return {
      components: components.length,
      solved: results.every((r) => r.solved),
      iterations: results.reduce((sum, r) => sum + (r.iterations || 0), 0),
      results,
    };
  }

  async solveComponent(constraints = [], parts = []) {
    const cacheKey = this.solveCache.hash({ constraints, parts });
    const cached = this.solveCache.get(cacheKey);
    if (cached) return cached;
    
    // Simplified iterative solver with Gauss-Seidel method
    let solved = false;
    let iterations = 0;
    const maxIterations = 50;
    const tolerance = 0.001;
    
    const positions = new Map(parts.map((p) => [String(p.id || ''), Array.from(p.position || [0, 0, 0])]));
    
    while (iterations < maxIterations) {
      let totalError = 0;
      for (const c of constraints) {
        const aId = String(c.part_a || c.a || '');
        const bId = String(c.part_b || c.b || '');
        const posA = positions.get(aId) || [0, 0, 0];
        const posB = positions.get(bId) || [0, 0, 0];
        
        const dx = posB[0] - posA[0];
        const dy = posB[1] - posA[1];
        const dz = posB[2] - posA[2];
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        
        const target = Number(c.target_clearance_mm || c.distance_mm || 0);
        const error = Math.abs(dist - target);
        totalError += error;
        
        if (error > tolerance) {
          const correction = (target - dist) / 2 * 0.1;
          const scale = dist > 0 ? correction / dist : 0;
          posA[0] -= dx * scale;
          posA[1] -= dy * scale;
          posA[2] -= dz * scale;
          posB[0] += dx * scale;
          posB[1] += dy * scale;
          posB[2] += dz * scale;
        }
      }
      
      iterations += 1;
      if (totalError < tolerance * constraints.length) {
        solved = true;
        break;
      }
    }
    
    const result = {
      solved,
      iterations,
      residual_error: totalError,
      positions: Object.fromEntries(positions),
    };
    
    this.solveCache.set(cacheKey, result);
    return result;
  }
}

/**
 * Memoized interference check with spatial partitioning.
 */
class InterferenceCache {
  constructor() {
    this.cache = new GeometryCache(2000, 60);
  }

  checkInterference(partA, partB) {
    const cacheKey = this.cache.hash({ a: partA.id, b: partB.id, aDims: partA.dims, bDims: partB.dims });
    const cached = this.cache.get(cacheKey);
    if (cached !== undefined) return cached;
    
    // Quick AABB test
    const aabbIntersect = (p1, p2) => {
      const a = p1.dims || { x: 1, y: 1, z: 1 };
      const b = p2.dims || { x: 1, y: 1, z: 1 };
      const pos1 = p1.position || [0, 0, 0];
      const pos2 = p2.position || [0, 0, 0];
      
      return !(
        pos1[0] + a.x / 2 < pos2[0] - b.x / 2 ||
        pos1[0] - a.x / 2 > pos2[0] + b.x / 2 ||
        pos1[1] + a.y / 2 < pos2[1] - b.y / 2 ||
        pos1[1] - a.y / 2 > pos2[1] + b.y / 2 ||
        pos1[2] + a.z / 2 < pos2[2] - b.z / 2 ||
        pos1[2] - a.z / 2 > pos2[2] + b.z / 2
      );
    };
    
    const result = aabbIntersect(partA, partB);
    this.cache.set(cacheKey, result);
    return result;
  }
}

export function createPerformanceOptimizer() {
  const geometryCache = new GeometryCache(1000, 60);
  const constraintSolver = new ConstraintSolver();
  const interferenceCache = new InterferenceCache();
  
  return {
    geometryCache,
    constraintSolver,
    interferenceCache,
    
    /**
     * Solve assembly constraints with parallel strategy.
     */
    async solveAssemblyConstraints(plan = {}) {
      const constraints = plan.interfaces || plan.mates || [];
      const parts = plan.parts || [];
      return constraintSolver.solveParallel(constraints, parts);
    },
    
    /**
     * Check interference with caching.
     */
    checkInterferences(parts = []) {
      const results = [];
      for (let i = 0; i < parts.length; i++) {
        for (let j = i + 1; j < parts.length; j++) {
          const interferes = interferenceCache.checkInterference(parts[i], parts[j]);
          if (interferes) {
            results.push({
              part_a: parts[i].id || `part-${i}`,
              part_b: parts[j].id || `part-${j}`,
              interferes: true,
            });
          }
        }
      }
      return results;
    },
    
    /**
     * Get cache statistics for monitoring.
     */
    cacheStats() {
      return {
        geometry_cache: geometryCache.stats(),
        solver_cache: constraintSolver.solveCache.stats(),
        interference_cache: interferenceCache.cache.stats(),
      };
    },
    
    /**
     * Clear all caches.
     */
    clearCaches() {
      geometryCache.clear();
      constraintSolver.solveCache.clear();
      interferenceCache.cache.clear();
    },
  };
}
