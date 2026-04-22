
import { Router } from 'express';
import { resolveActor, requireActor } from '../auth/actorResolver.mjs';

export function buildCadHistoryRoutes(runtime, cadExecutionStore, artifactStore) {
  const router = Router();

  router.get('/project/:projectId', async (req, res) => {
    try {
      const actor = await resolveActor(req, runtime);
      requireActor(actor);
      let executions = [];
      if (cadExecutionStore?.listProjectExecutions) {
        executions = await cadExecutionStore.listProjectExecutions(req.params.projectId);
      }
      if ((!executions || !executions.length) && artifactStore?.listProjectExecutions) {
        executions = artifactStore.listProjectExecutions(req.params.projectId);
      }
      return res.json({ ok: true, executions: executions || [] });
    } catch (error) {
      return res.status(error.statusCode || 500).json({ ok: false, error: error.message });
    }
  });

  router.get('/execution/:executionId', async (req, res) => {
    try {
      const actor = await resolveActor(req, runtime);
      requireActor(actor);
      let execution = null;
      if (cadExecutionStore?.getExecutionManifest) {
        execution = await cadExecutionStore.getExecutionManifest(req.params.executionId);
      }
      if (!execution && artifactStore?.getManifest) {
        execution = artifactStore.getManifest(req.params.executionId);
      }
      if (!execution) return res.status(404).json({ ok: false, error: 'Execution not found' });
      return res.json({ ok: true, execution });
    } catch (error) {
      return res.status(error.statusCode || 500).json({ ok: false, error: error.message });
    }
  });

  router.get('/execution/:executionId/artifacts', async (req, res) => {
    try {
      const actor = await resolveActor(req, runtime);
      requireActor(actor);
      if (!artifactStore?.listArtifacts) {
        return res.status(503).json({ ok: false, error: 'Artifact store unavailable' });
      }
      const executionId = req.params.executionId;
      const manifest = artifactStore.getManifest?.(executionId) || null;
      const files = artifactStore.listArtifacts(executionId) || [];
      if (!files.length && !manifest) return res.status(404).json({ ok: false, error: 'Execution not found' });

      const manifestArtifacts = Array.isArray(manifest?.artifacts) ? manifest.artifacts : [];
      const artifacts = files.map((file) => {
        const matched = manifestArtifacts.find((item) => item.filename === file.filename) || {};
        return {
          execution_id: executionId,
          filename: file.filename,
          bytes: file.bytes,
          updated_at: file.updated_at,
          created_at: file.created_at,
          type: matched.type || 'file',
          url: matched.url || `/cad/artifacts/${executionId}/${file.filename}`,
          mirrored: Boolean(matched.mirrored),
        };
      });
      return res.json({ ok: true, execution_id: executionId, artifacts, manifest });
    } catch (error) {
      return res.status(error.statusCode || 500).json({ ok: false, error: error.message });
    }
  });

  return router;
}
