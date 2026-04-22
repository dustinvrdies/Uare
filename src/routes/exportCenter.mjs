export function registerExportCenterRoutes(app) {
  app.get('/exports/summary', (req, res) => {
    res.json({
      bundles: [
        { id: 'cad', label: 'CAD Package', ready: true },
        { id: 'pcb', label: 'PCB Package', ready: true },
        { id: 'simulation', label: 'Simulation Report', ready: true },
        { id: 'bom', label: 'BOM + Dimensions', ready: true },
        { id: 'patent', label: 'Patent Draft', ready: true }
      ]
    });
  });
}
