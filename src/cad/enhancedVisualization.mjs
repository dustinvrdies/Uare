/**
 * Enhanced visualization layer for WebGL: animations, material rendering, and exploded views.
 * Provides browser-side rendering optimization and interactive assembly visualization.
 */

export function buildVisualizationConfig(plan = {}, options = {}) {
  return {
    viewport: {
      width_px: options.width || 1200,
      height_px: options.height || 800,
      fov_degrees: 45,
      near_m: 0.01,
      far_m: 1000,
      background_color: options.background || '#ffffff',
      antialiasing: true,
      shadow_map_enabled: true,
    },
    lighting: {
      ambient_intensity: 0.6,
      directional_lights: [
        { position: [1, 1, 1], intensity: 0.8, color: 0xffffff },
        { position: [-1, -0.5, -1], intensity: 0.3, color: 0xcccccc },
      ],
      point_lights: [],
    },
    materials: buildMaterialPalette(plan.parts || []),
    interactions: {
      orbit_controls_enabled: true,
      part_selection_enabled: true,
      transparency_controls: true,
      explode_animation_enabled: true,
    },
  };
}

export function buildMaterialPalette(parts = []) {
  const materialMap = {};
  
  const materialVisuals = {
    steel: { color: '#4a4a4a', roughness: 0.5, metallic: 1.0 },
    aluminum_6061: { color: '#c0c0c0', roughness: 0.3, metallic: 0.9 },
    copper: { color: '#b87333', roughness: 0.2, metallic: 1.0 },
    titanium: { color: '#878681', roughness: 0.4, metallic: 0.95 },
    plastic: { color: '#e8e8e8', roughness: 0.7, metallic: 0.0 },
    fr4: { color: '#2d5016', roughness: 0.6, metallic: 0.1 },
    rubber: { color: '#333333', roughness: 0.9, metallic: 0.0 },
    ceramic: { color: '#f5f5dc', roughness: 0.8, metallic: 0.0 },
  };
  
  for (const part of parts) {
    const material = String(part.material || 'steel').toLowerCase();
    if (!materialMap[material]) {
      materialMap[material] = materialVisuals[material] || {
        color: '#cccccc',
        roughness: 0.5,
        metallic: 0.3,
      };
    }
  }
  
  return materialMap;
}

export function buildExplodedViewAnimation(plan = {}, options = {}) {
  const parts = plan.parts || [];
  const durationMs = Number(options.duration_ms || 2000);
  const explosionFactor = Number(options.explosion_factor || 5);
  
  // Calculate centroid
  const centroid = { x: 0, y: 0, z: 0 };
  for (const part of parts) {
    const pos = part.position || [0, 0, 0];
    centroid.x += pos[0];
    centroid.y += pos[1];
    centroid.z += pos[2];
  }
  centroid.x /= parts.length;
  centroid.y /= parts.length;
  centroid.z /= parts.length;
  
  // Generate keyframes for each part
  const keyframes = parts.map((part, index) => {
    const pos = part.position || [0, 0, 0];
    const direction = {
      x: pos[0] - centroid.x,
      y: pos[1] - centroid.y,
      z: pos[2] - centroid.z,
    };
    const length = Math.sqrt(direction.x ** 2 + direction.y ** 2 + direction.z ** 2) || 1;
    direction.x /= length;
    direction.y /= length;
    direction.z /= length;
    
    const distance = length * explosionFactor;
    
    return {
      part_id: part.id || `part-${index}`,
      keyframes: [
        { time_ms: 0, position: pos, opacity: 1.0, scale: 1.0 },
        { time_ms: durationMs / 2, position: [pos[0] + direction.x * distance / 2, pos[1] + direction.y * distance / 2, pos[2] + direction.z * distance / 2], opacity: 1.0, scale: 1.0 },
        { time_ms: durationMs, position: [pos[0] + direction.x * distance, pos[1] + direction.y * distance, pos[2] + direction.z * distance], opacity: 0.8, scale: 1.0 },
      ],
      easing: 'easeInOutCubic',
    };
  });
  
  return {
    animation_name: 'exploded_view',
    duration_ms: durationMs,
    loopable: true,
    keyframes,
  };
}

export function buildAssemblyAnimationSequence(plan = {}, options = {}) {
  const parts = plan.parts || [];
  const constraints = plan.interfaces || plan.mates || [];
  
  // Sort parts by assembly order (dependencies)
  const assembled = new Set();
  const animationSequence = [];
  const remaining = new Set(parts.map((_, i) => i));
  
  let safety = 0;
  while (remaining.size > 0 && safety < 1000) {
    safety++;
    for (const idx of remaining) {
      const part = parts[idx];
      const deps = constraints
        .filter((c) => {
          const bId = String(c.part_b || c.b || '');
          return bId === String(part.id || `part-${idx}`);
        })
        .map((c) => {
          const aId = String(c.part_a || c.a || '');
          return parts.findIndex((p) => String(p.id || `part-${parts.indexOf(p)}`) === aId);
        });
      
      const allDepsMet = deps.every((d) => d === -1 || assembled.has(d));
      
      if (allDepsMet) {
        const startMs = animationSequence.length * 500;
        animationSequence.push({
          step: animationSequence.length + 1,
          part_id: part.id || `part-${idx}`,
          action: 'snap_into_place',
          start_time_ms: startMs,
          duration_ms: 400,
          animation_type: 'slide_and_rotate',
        });
        
        assembled.add(idx);
        remaining.delete(idx);
      }
    }
  }
  
  return {
    sequence_name: 'assembly_animation',
    total_duration_ms: animationSequence.length * 500,
    animation_sequence: animationSequence,
  };
}

export function buildPartDetailVisualization(part = {}, visualOptions = {}) {
  const dims = part.dims || { x: 100, y: 100, z: 100 };
  
  return {
    part_id: part.id || 'unknown',
    geometry: {
      bounds: { min: [-dims.x / 2, -dims.y / 2, -dims.z / 2], max: [dims.x / 2, dims.y / 2, dims.z / 2] },
      bounding_sphere_radius: Math.sqrt((dims.x ** 2 + dims.y ** 2 + dims.z ** 2) / 3) / 2,
      volume_mm3: dims.x * dims.y * dims.z,
    },
    material: {
      name: part.material || 'steel',
      color_hex: visualOptions.color || '#cccccc',
      roughness: visualOptions.roughness || 0.5,
      metallic: visualOptions.metallic || 0.3,
      show_wireframe: visualOptions.wireframe || false,
    },
    annotations: [
      { position: [0, dims.y / 2 + 10, 0], label: `L: ${dims.x}mm`, type: 'dimension' },
      { position: [dims.x / 2 + 10, 0, 0], label: `W: ${dims.y}mm`, type: 'dimension' },
      { position: [0, 0, dims.z / 2 + 10], label: `H: ${dims.z}mm`, type: 'dimension' },
    ],
    interactions: {
      highlight_on_select: true,
      show_bounding_box: true,
      allow_rotation: true,
      allow_transparency: true,
    },
  };
}

export function buildLoadVisualizationMap(analysis = {}) {
  return {
    type: 'heat_map',
    scale: {
      min_value: 0,
      max_value: 100,
      units: 'stress_percentage',
      color_map: 'viridis', // or 'jet', 'hot', etc.
    },
    data: {
      nodes: analysis.stress_points || [],
      values: analysis.stress_values || [],
    },
  };
}

export function buildMaterialVisualization(part = {}) {
  const materialProps = {
    steel: { color: '#4a4a4a', icon: 'bolt', density_label: '7.85 g/cm³' },
    aluminum_6061: { color: '#c0c0c0', icon: 'lightweight', density_label: '2.7 g/cm³' },
    copper: { color: '#b87333', icon: 'conductor', density_label: '8.96 g/cm³' },
    titanium: { color: '#878681', icon: 'premium', density_label: '4.5 g/cm³' },
  };
  
  const material = String(part.material || 'steel').toLowerCase();
  const props = materialProps[material] || materialProps.steel;
  
  return {
    material_name: material,
    visual: {
      color_hex: props.color,
      icon: props.icon,
      texture: `material_${material}`,
    },
    properties: {
      density_label: props.density_label,
      cost_indicator: material === 'titanium' ? 'high' : material === 'aluminum_6061' ? 'medium' : 'low',
      recyclability: 'high',
    },
  };
}

export function buildVisualizationManifest(plan = {}, options = {}) {
  return {
    version: '1.0',
    viewport_config: buildVisualizationConfig(plan, options),
    assembly_animation: buildAssemblyAnimationSequence(plan, options),
    exploded_view: buildExplodedViewAnimation(plan, options),
    part_visualizations: (plan.parts || []).map((p) => buildPartDetailVisualization(p, options)),
    material_visualizations: (plan.parts || []).map((p) => buildMaterialVisualization(p)),
    interaction_hints: {
      orbit_mouse_drag: 'Rotate view',
      zoom_scroll: 'Zoom in/out',
      left_click: 'Select part',
      spacebar: 'Toggle exploded view',
      'a': 'Play assembly animation',
      'e': 'Toggle environment lighting',
    },
  };
}
