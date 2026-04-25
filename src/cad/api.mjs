/**
 * REST API wrapper for the CAD planner service
 * Provides HTTP endpoints and WebSocket support for real-time updates
 */

import express from 'express';
import { WebSocket, WebSocketServer } from 'ws';
import { createCADPlanner } from './plannerService.mjs';

export class CADPlannerAPI {
  constructor(options = {}) {
    this.app = express();
    this.port = options.port || 3000;
    this.planner = createCADPlanner(options);
    this.wss = null;
    this.clients = new Set();
    
    this.setupMiddleware();
    this.setupRoutes();
  }
  
  setupMiddleware() {
    this.app.use(express.json({ limit: '50mb' }));
    this.app.use((req, res, next) => {
      res.set('Content-Type', 'application/json');
      next();
    });
  }
  
  setupRoutes() {
    // GET /plans - List all plans
    this.app.get('/plans', (req, res) => {
      try {
        const plans = this.planner.listPlans();
        res.json({ success: true, plans });
      } catch (error) {
        res.status(500).json({ success: false, error: error.message });
      }
    });
    
    // POST /plans - Create new plan
    this.app.post('/plans', (req, res) => {
      try {
        const { spec, constraints, options } = req.body;
        const result = this.planner.generatePlan(spec, constraints);
        
        if (result.success) {
          this.broadcastUpdate({ type: 'plan_created', plan_id: result.plan_id });
        }
        
        res.json(result);
      } catch (error) {
        res.status(400).json({ success: false, error: error.message });
      }
    });
    
    // GET /plans/:planId - Get plan details
    this.app.get('/plans/:planId', (req, res) => {
      try {
        const plan = this.planner.plans.get(req.params.planId);
        if (!plan) {
          return res.status(404).json({ success: false, error: 'Plan not found' });
        }
        res.json({ success: true, plan });
      } catch (error) {
        res.status(500).json({ success: false, error: error.message });
      }
    });
    
    // GET /plans/:planId/summary - Get plan summary
    this.app.get('/plans/:planId/summary', (req, res) => {
      try {
        const summary = this.planner.getPlanSummary(req.params.planId);
        if (!summary) {
          return res.status(404).json({ success: false, error: 'Plan not found' });
        }
        res.json({ success: true, summary });
      } catch (error) {
        res.status(500).json({ success: false, error: error.message });
      }
    });
    
    // GET /plans/:planId/analysis - Analyze plan
    this.app.get('/plans/:planId/analysis', (req, res) => {
      try {
        const result = this.planner.analyzePlan(req.params.planId);
        res.json(result);
      } catch (error) {
        res.status(500).json({ success: false, error: error.message });
      }
    });
    
    // GET /plans/:planId/visualization - Get visualization manifest
    this.app.get('/plans/:planId/visualization', (req, res) => {
      try {
        const manifest = this.planner.getVisualizationManifest(req.params.planId);
        if (!manifest) {
          return res.status(404).json({ success: false, error: 'Plan not found' });
        }
        res.json({ success: true, manifest });
      } catch (error) {
        res.status(500).json({ success: false, error: error.message });
      }
    });
    
    // GET /plans/:planId/manufacturing - Get manufacturing documentation
    this.app.get('/plans/:planId/manufacturing', (req, res) => {
      try {
        const docs = this.planner.getManufacturingDocumentation(req.params.planId);
        if (!docs) {
          return res.status(404).json({ success: false, error: 'Plan not found' });
        }
        res.json({ success: true, docs });
      } catch (error) {
        res.status(500).json({ success: false, error: error.message });
      }
    });
    
    // POST /plans/:planId/export - Export plan
    this.app.post('/plans/:planId/export', (req, res) => {
      try {
        const { format = 'json' } = req.body;
        const result = this.planner.exportPlan(req.params.planId, format);
        
        if (result.success) {
          res.set('Content-Disposition', `attachment; filename="${result.filename}"`);
          res.set('Content-Type', format === 'json' ? 'application/json' : 'text/plain');
          res.send(result.data);
        } else {
          res.status(400).json(result);
        }
      } catch (error) {
        res.status(500).json({ success: false, error: error.message });
      }
    });
    
    // GET /health - Health check
    this.app.get('/health', (req, res) => {
      res.json({ status: 'healthy', timestamp: new Date().toISOString() });
    });
  }
  
  start() {
    this.server = this.app.listen(this.port, () => {
      console.log(`CAD Planner API listening on port ${this.port}`);
    });
    
    // Setup WebSocket
    this.wss = new WebSocketServer({ server: this.server });
    this.wss.on('connection', (ws) => {
      console.log('Client connected');
      this.clients.add(ws);
      
      ws.on('message', (data) => {
        try {
          const message = JSON.parse(data);
          this.handleWebSocketMessage(ws, message);
        } catch (error) {
          ws.send(JSON.stringify({ error: 'Invalid message format' }));
        }
      });
      
      ws.on('close', () => {
        console.log('Client disconnected');
        this.clients.delete(ws);
      });
      
      ws.send(JSON.stringify({ type: 'connection', message: 'Connected to CAD Planner API' }));
    });
    
    return this.server;
  }
  
  handleWebSocketMessage(ws, message) {
    const { type, payload } = message;
    
    switch (type) {
      case 'generate_plan':
        const result = this.planner.generatePlan(payload.spec, payload.constraints);
        ws.send(JSON.stringify({ type: 'plan_generated', payload: result }));
        this.broadcastUpdate({ type: 'plan_created', plan_id: result.plan_id });
        break;
        
      case 'analyze_plan':
        const analysis = this.planner.analyzePlan(payload.plan_id);
        ws.send(JSON.stringify({ type: 'analysis_complete', payload: analysis }));
        break;
        
      case 'export_plan':
        const exported = this.planner.exportPlan(payload.plan_id, payload.format || 'json');
        ws.send(JSON.stringify({ type: 'export_complete', payload: exported }));
        break;
        
      default:
        ws.send(JSON.stringify({ error: `Unknown message type: ${type}` }));
    }
  }
  
  broadcastUpdate(update) {
    const message = JSON.stringify(update);
    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    }
  }
  
  stop() {
    if (this.server) {
      this.server.close();
      console.log('CAD Planner API stopped');
    }
  }
}

// Export factory
export function startCADPlannerAPI(options = {}) {
  const api = new CADPlannerAPI(options);
  api.start();
  return api;
}
