import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { spawnSync } from 'child_process';
import { resolveActor, requireActor } from '../auth/actorResolver.mjs';
import { deriveCadLearningEvent } from '../learning/eventFactory.mjs';
import { buildExecutionAdapterPlan } from '../workers/adapters.mjs';

export function buildCadRoutes(runtime, cadExecutionService, artifactStore, learningStore, taskStore, jobStore) {
  const router = Router();

  function createArchive(tmpBase, executionId, zipPath) {
    if (process.platform === 'win32') {
      const sourcePath = path.join(tmpBase, executionId);
      const ps = spawnSync('powershell', [
        '-NoProfile',
        '-Command',
        `Compress-Archive -Path "${sourcePath}\\*" -DestinationPath "${zipPath}" -Force`,
      ]);
      return ps.status === 0 && fs.existsSync(zipPath);
    }

    const zipped = spawnSync('zip', ['-r', '-q', zipPath, executionId], { cwd: tmpBase });
    return zipped.status === 0 && fs.existsSync(zipPath);
  }

  router.post('/execute', async (req, res) => {
    try {
      const actor = await resolveActor(req, runtime);
      requireActor(actor);

      const plan = req.body?.plan || {};
      const executionTarget = plan?.execution_target || runtime.cadExecutionTarget || 'in_process';

      if (executionTarget !== 'in_process') {
        const manifest = cadExecutionService.buildQueuedManifest(plan, actor, { executionTarget });
        if (manifest.status === 'blocked') {
          return res.status(422).json({
            ok: false,
            error: 'CAD execution blocked by critical engineering guardrails.',
            manifest,
          });
        }
        const dispatch = buildExecutionAdapterPlan('cad', executionTarget, { execution_id: manifest.execution_id, plan }, runtime);
        manifest.dispatch = dispatch;
        await cadExecutionService.persistManifest(manifest);
        const task = await taskStore.submitTask({
          kind: 'cad',
          source_id: manifest.execution_id,
          execution_target: executionTarget,
          payload: { execution_id: manifest.execution_id, plan, dispatch },
          metadata: { project_id: manifest.project_id, dispatch },
        });
        await jobStore?.create('cad', {
          execution_id: manifest.execution_id,
          actor_id: manifest.actor_id,
          project_id: manifest.project_id,
          status: manifest.status,
          execution_target: executionTarget,
          task_id: task.task_id,
          payload_json: plan,
          result_json: manifest,
          progress_json: manifest.progress || { percent: 5, stage: 'queued', detail: 'CAD execution queued' },
          metadata_json: { dispatch },
        });
        return res.status(202).json({ ok: true, manifest: { ...manifest, dispatch_task_id: task.task_id, learning_event_id: null }, task, message: 'CAD execution queued for worker claim.' });
      }

      const manifest = await cadExecutionService.execute(plan, actor, { executionTarget });
      const learningEvent = await learningStore.recordEvent(deriveCadLearningEvent(manifest, actor));
      await jobStore?.create('cad', {
        execution_id: manifest.execution_id,
        actor_id: manifest.actor_id,
        project_id: manifest.project_id,
        status: manifest.status,
        execution_target: executionTarget,
        task_id: null,
        learning_event_id: learningEvent.event_id,
        payload_json: plan,
        result_json: manifest,
        progress_json: { percent: 100, stage: manifest.status || 'completed', detail: 'CAD execution completed' },
        metadata_json: {},
      });

      return res.json({ ok: true, manifest: { ...manifest, learning_event_id: learningEvent.event_id }, learning_event: learningEvent, message: 'Deterministic CAD execution completed.' });
    } catch (error) {
      return res.status(error.statusCode || 500).json({
        ok: false,
        error: error.message,
        code: error.code || null,
        details: error.details || null,
        suggestions: error.suggestions || null,
      });
    }
  });

  router.post('/analyze', async (req, res) => {
    try {
      const actor = await resolveActor(req, runtime);
      requireActor(actor);
      const plan = req.body?.plan || {};
      const analysis = cadExecutionService.analyze(plan, actor);
      return res.status(analysis.ok ? 200 : 422).json({ ok: analysis.ok, analysis });
    } catch (error) {
      return res.status(error.statusCode || 500).json({
        ok: false,
        error: error.message,
        code: error.code || null,
      });
    }
  });

  router.get('/status/:executionId', async (req, res) => {
    const manifest = cadExecutionService.getStatus(req.params.executionId);
    if (!manifest) return res.status(404).json({ ok: false, error: 'Execution not found' });
    return res.json({ ok: true, manifest });
  });

  router.get('/kernel-health', async (req, res) => {
    try {
      const health = cadExecutionService.getKernelHealth();
      const ok = Boolean(health?.kernel_enabled) && Boolean(health?.probes?.version_ok) && Boolean(health?.probes?.modules_ok);
      return res.status(ok ? 200 : 503).json({ ok, health });
    } catch (error) {
      return res.status(500).json({
        ok: false,
        error: error.message,
        code: 'CAD_KERNEL_HEALTH_ERROR',
      });
    }
  });


  router.get('/executions/:executionId/artifacts', async (req, res) => {
    const executionId = req.params.executionId;
    const manifest = artifactStore.getManifest?.(executionId) || cadExecutionService.getStatus?.(executionId) || null;
    const files = artifactStore.listArtifacts?.(executionId) || [];
    if (!manifest && !files.length) return res.status(404).json({ ok: false, error: 'Execution not found' });
    const manifestArtifacts = Array.isArray(manifest?.artifacts) ? manifest.artifacts : [];
    return res.json({
      ok: true,
      execution_id: executionId,
      artifacts: files.map((file) => {
        const matched = manifestArtifacts.find((item) => item.filename === file.filename) || {};
        return {
          execution_id: executionId,
          filename: file.filename,
          bytes: file.bytes,
          created_at: file.created_at,
          updated_at: file.updated_at,
          type: matched.type || 'file',
          url: matched.url || `/cad/artifacts/${executionId}/${file.filename}`,
          mirrored: Boolean(matched.mirrored),
        };
      }),
      manifest,
    });
  });


  router.get('/executions/:executionId/package', async (req, res) => {
    const executionId = req.params.executionId;
    const manifest = artifactStore.getManifest?.(executionId) || cadExecutionService.getStatus?.(executionId) || null;
    const files = artifactStore.listArtifacts?.(executionId) || [];
    if (!manifest && !files.length) return res.status(404).json({ ok: false, error: 'Execution not found' });

    const bundleKinds = new Set(['kicad_pcb', 'kicad_schematic', 'easyeda_project', 'simulation_report', 'spice_netlist', 'gerber', 'drill', 'bom_json', 'bom_csv', 'dimensions', 'features', 'viewer_manifest', 'assembly_instructions', 'step_exchange', 'glb_mesh', 'obj_mesh', 'stl_mesh', 'assembly_document', 'part_manifest']);
    const manifestArtifacts = Array.isArray(manifest?.artifacts) ? manifest.artifacts : [];
    const selectedFiles = files.filter((file) => {
      const matched = manifestArtifacts.find((item) => item.filename === file.filename) || {};
      const filename = String(file.filename || '').toLowerCase();
      return bundleKinds.has(matched.type) || /\.(gbr|drl|kicad_pcb|kicad_sch|spice|csv|step|glb|obj|stl|json|md)$/i.test(filename);
    });

    const executionDir = artifactStore.executionDir(executionId);
    const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'uare-package-'));
    const stageDir = path.join(tmpBase, executionId);
    fs.mkdirSync(stageDir, { recursive: true });
    for (const file of selectedFiles) {
      const src = path.join(executionDir, file.filename);
      if (fs.existsSync(src)) fs.copyFileSync(src, path.join(stageDir, file.filename));
    }
    const summary = {
      execution_id: executionId,
      exported_at: new Date().toISOString(),
      files: selectedFiles.map((file) => file.filename),
      manifest: manifest || null,
    };
    fs.writeFileSync(path.join(stageDir, 'package_manifest.json'), JSON.stringify(summary, null, 2));
    const zipPath = path.join(tmpBase, `${executionId}-manufacturing-package.zip`);
    if (!createArchive(tmpBase, executionId, zipPath)) {
      return res.status(500).json({ ok: false, error: 'Failed to build package archive' });
    }
    res.download(zipPath, `${executionId}-manufacturing-package.zip`, () => {
      try { fs.rmSync(tmpBase, { recursive: true, force: true }); } catch {}
    });
  });

  router.get('/artifacts/:executionId/:filename', async (req, res) => {
    const executionId = req.params.executionId;
    const filename = req.params.filename;

    // Keep CAD viewing inside the unified app shell instead of standalone preview pages.
    if (String(filename).toLowerCase() === 'preview.html') {
      const query = new URLSearchParams({ execution_id: executionId }).toString();
      return res.redirect(302, `/lab/?${query}`);
    }

    const filePath = path.join(artifactStore.executionDir(executionId), filename);

    if (!fs.existsSync(filePath)) return res.status(404).json({ ok: false, error: 'Artifact not found' });
    if (filename.endsWith('.svg')) res.type('image/svg+xml');
    if (filename.endsWith('.stl')) res.type('model/stl');
    if (filename.endsWith('.json')) res.type('application/json');
    if (filename.endsWith('.py')) res.type('text/plain');
    if (filename.endsWith('.glb')) res.type('model/gltf-binary');
    if (filename.endsWith('.obj')) res.type('text/plain');
    if (filename.endsWith('.step')) res.type('application/step');
    if (filename.endsWith('.kicad_pcb') || filename.endsWith('.kicad_sch') || filename.endsWith('.md') || filename.endsWith('.gbr') || filename.endsWith('.drl') || filename.endsWith('.spice') || filename.endsWith('.csv')) res.type('text/plain');
    return res.sendFile(filePath);
  });

  return router;
}
