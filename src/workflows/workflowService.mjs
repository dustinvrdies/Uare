import crypto from 'crypto';
import { buildExecutionAdapterPlan } from '../workers/adapters.mjs';
import { getWorkflowDefinition, buildInitialStepStatus } from './workflowDefinitions.mjs';
import { createWorkflowLockManager } from './lockManager.mjs';
import { createWorkflowStepPluginRegistry } from './stepPlugins.mjs';
import { predictOutcome } from '../learning/predictiveModels.mjs';
import { recommendMutation } from '../learning/mutationModels.mjs';
import { optimizePortfolio } from '../portfolio/portfolioOptimizer.mjs';

function nowIso() {
  return new Date().toISOString();
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function makeRunId() {
  return `wf-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
}

function dedupeTimeline(entries = []) {
  const seen = new Set();
  const output = [];
  for (const entry of entries) {
    if (!entry) continue;
    const key = JSON.stringify([
      entry.type || null,
      entry.step || null,
      entry.status || null,
      entry.message || null,
      entry.related_id || null,
      entry.at || null,
    ]);
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(entry);
  }
  return output;
}

function buildRunPatch(run = {}, patch = {}, timelineEntry = null) {
  const currentState = clone(run.state_json || {});
  const patchState = clone(patch.state_json || {});
  const nextStepStatus = {
    ...(currentState.step_status || {}),
    ...(patchState.step_status || {}),
  };
  const nextDispatchKeys = {
    ...(currentState.dispatch_keys || {}),
    ...(patchState.dispatch_keys || {}),
  };
  const nextStepLeases = {
    ...(currentState.step_leases || {}),
    ...(patchState.step_leases || {}),
  };
  const nextStepResults = {
    ...(currentState.step_results || {}),
    ...(patchState.step_results || {}),
  };
  const timeline = dedupeTimeline([
    ...(currentState.timeline || []),
    ...(patchState.timeline || []),
    ...(timelineEntry ? [timelineEntry] : []),
  ]);
  return {
    ...patch,
    state_json: {
      ...currentState,
      ...patchState,
      step_status: nextStepStatus,
      dispatch_keys: nextDispatchKeys,
      step_leases: nextStepLeases,
      step_results: nextStepResults,
      timeline,
    },
  };
}

function isTerminalRun(run = {}) {
  return ['completed', 'failed', 'cancelled'].includes(run.status);
}

function isTaskTerminal(task = {}) {
  return ['completed', 'failed'].includes(task?.status);
}

function isLeaseExpired(lease = {}) {
  if (!lease?.lease_expires_at) return true;
  return new Date(lease.lease_expires_at).getTime() <= Date.now();
}

function activeLeaseFor(run = {}, step) {
  const lease = run.state_json?.step_leases?.[step] || null;
  if (!lease || isLeaseExpired(lease)) return null;
  return lease;
}


function inferPhysicsDomain(run = {}) {
  const solverPayload = run.payload_json?.solver_payload || {};
  const analysisTarget = String(solverPayload.analysis_target || run.payload_json?.metadata?.analysis_target || '').toLowerCase();
  const params = run.payload_json?.cad_plan?.recipe?.parameters || {};
  if (['fluid','fluid_basic','flow','cfd'].includes(analysisTarget)) return { domain: 'fluid_basic', reason: 'analysis_target_flow' };
  if (['kinematics','mechanism','motion'].includes(analysisTarget)) return { domain: 'kinematics', reason: 'analysis_target_motion' };
  if (['structural','structural_static','mechanical'].includes(analysisTarget)) return { domain: 'structural_static', reason: 'analysis_target_structural' };
  if (solverPayload.workspace_target_mm || params.link_count || params.joint_count) return { domain: 'kinematics', reason: 'mechanism_geometry_detected' };
  if (solverPayload.target_flow_rate_lpm || params.channel_diameter_mm || params.bend_count) return { domain: 'fluid_basic', reason: 'flow_geometry_detected' };
  return { domain: 'structural_static', reason: 'default_structural_fallback' };
}

function buildPhysicsRequestForRun(run = {}, domain = 'structural_static') {
  const params = run.payload_json?.cad_plan?.recipe?.parameters || {};
  const solverPayload = run.payload_json?.solver_payload || {};
  if (domain === 'kinematics') {
    return {
      domain,
      fidelity_tier: 'tier_2_mid',
      project_id: run.project_id || null,
      geometry: solverPayload.geometry || { links: solverPayload.links || [], joints: solverPayload.joints || [], collision_pairs: solverPayload.collision_pairs || [] },
      solver_settings: {
        workspace_target_mm: solverPayload.workspace_target_mm || 100,
        cycle_target_ms: solverPayload.cycle_target_ms || 1500,
      },
      metadata: { workflow_run_id: run.run_id },
    };
  }
  if (domain === 'fluid_basic') {
    return {
      domain,
      fidelity_tier: 'tier_2_mid',
      project_id: run.project_id || null,
      geometry: { type: 'parametric', parameters: {
        channel_length_mm: params.channel_length_mm || params.length_mm || 150,
        channel_diameter_mm: params.channel_diameter_mm || 8,
        bend_count: params.bend_count || 0,
        surface_roughness_mm: params.surface_roughness_mm || 0.02,
      } },
      materials: {
        fluid_density_kg_m3: solverPayload.materials?.fluid_density_kg_m3 || 997,
        dynamic_viscosity_cp: solverPayload.materials?.dynamic_viscosity_cp || 1,
      },
      solver_settings: {
        target_flow_rate_lpm: solverPayload.target_flow_rate_lpm || 1,
        max_pressure_drop_pa: solverPayload.max_pressure_drop_pa || 25000,
      },
      metadata: { workflow_run_id: run.run_id },
    };
  }
  return {
    domain: 'structural_static',
    fidelity_tier: 'tier_2_mid',
    project_id: run.project_id || null,
    geometry: { type: 'parametric', parameters: params },
    materials: {
      youngs_modulus_mpa: solverPayload.materials?.youngs_modulus_mpa || 69000,
      yield_strength_mpa: solverPayload.materials?.yield_strength_mpa || 250,
    },
    loads: solverPayload.loads || [],
    boundary_conditions: solverPayload.constraints || [],
    metadata: { workflow_run_id: run.run_id },
  };
}


function deepMerge(base = {}, patch = {}) {
  const output = Array.isArray(base) ? base.slice() : { ...base };
  for (const [key, value] of Object.entries(patch || {})) {
    if (value && typeof value === 'object' && !Array.isArray(value) && typeof output[key] === 'object' && output[key] !== null && !Array.isArray(output[key])) {
      output[key] = deepMerge(output[key], value);
    } else {
      output[key] = value;
    }
  }
  return output;
}

export function createWorkflowService(runtime = {}, workflowStore, taskStore, jobStore, cadExecutionService, solverJobService, learningStore, physicsJobService = null) {
  const lockManager = createWorkflowLockManager(runtime);
  const parallelReadyStepLimit = Math.max(Number(runtime.workflowParallelReadySteps || 2), 1);
  const stepLeaseMs = Math.max(Number(runtime.workflowStepLeaseMs || runtime.taskLeaseMs || 300000), 1000);

  async function withRunLock(runId, fn) {
    return lockManager.withRunLock(runId, fn);
  }

  function buildLineage(input = {}, actor = {}) {
    const lineage = input.lineage || input.metadata?.lineage || {};
    const rootRunId = lineage.root_run_id || lineage.parent_run_id || input.run_id || null;
    return {
      root_run_id: rootRunId,
      parent_run_id: lineage.parent_run_id || null,
      branch_key: lineage.branch_key || 'main',
      reopen_of_run_id: lineage.reopen_of_run_id || null,
      created_by_actor_id: actor?.id || 'unknown',
      created_at: nowIso(),
    };
  }

  function buildStepRetryCounts(definition = {}) {
    const counts = {};
    for (const step of definition.ordered_steps || []) counts[step] = 0;
    return counts;
  }

  function buildBranchPolicy(input = {}) {
    const provided = input?.options?.branch_policy || input?.branch_policy || {};
    const templates = Array.isArray(provided.templates) ? provided.templates.map((entry, index) => ({
      branch_key: String(entry?.branch_key || `branch-${index + 1}`),
      workflow_type: entry?.workflow_type || input.workflow_type || 'cad_solver_pipeline',
      requested_steps: Array.isArray(entry?.requested_steps) && entry.requested_steps.length ? entry.requested_steps : (input.requested_steps || ['cad', 'solver']),
      cad_plan_patch: clone(entry?.cad_plan_patch || {}),
      solver_payload_patch: clone(entry?.solver_payload_patch || {}),
      metadata_patch: clone(entry?.metadata_patch || {}),
      options_patch: clone(entry?.options_patch || {}),
      score_bias: Number(entry?.score_bias || 0),
    })) : [];
    return {
      enabled: provided.enabled !== false,
      auto_branch_on_completion: provided.auto_branch_on_completion === true,
      auto_reopen_on_failure: provided.auto_reopen_on_failure === true,
      max_children_per_run: Math.max(Number(provided.max_children_per_run || runtime.workflowBranchMaxChildren || 2), 0),
      max_reopens_per_run: Math.max(Number(provided.max_reopens_per_run || runtime.workflowBranchMaxReopens || 1), 0),
      min_score_to_branch: Number(provided.min_score_to_branch || runtime.workflowBranchMinScore || 0),
      selection_mode: provided.selection_mode || 'score_desc',
      score_weights: {
        completion: Number(provided?.score_weights?.completion ?? 0.4),
        cad_valid: Number(provided?.score_weights?.cad_valid ?? 0.15),
        manufacturable: Number(provided?.score_weights?.manufacturable ?? 0.15),
        solver_success: Number(provided?.score_weights?.solver_success ?? 0.2),
        retries_penalty: Number(provided?.score_weights?.retries_penalty ?? 0.1),
        novelty_hint: Number(provided?.score_weights?.novelty_hint ?? 0.1),
        template_bias: Number(provided?.score_weights?.template_bias ?? 0.05),
      },
      templates,
    };
  }


  function buildEvaluationPolicy(input = {}) {
    const provided = input?.options?.evaluation_policy || input?.evaluation_policy || {};
    return {
      enabled: provided.enabled !== false,
      max_finalists_per_root: Math.max(Number(provided.max_finalists_per_root || runtime.workflowTieredMaxFinalistsPerRoot || 1), 1),
      min_branch_score_for_verification: Number(provided.min_branch_score_for_verification || runtime.workflowTieredMinScoreForVerification || 0),
      require_physics_pass: provided.require_physics_pass !== false && runtime.workflowTieredRequirePhysicsPass !== false,
      require_mid_fidelity_pass: provided.require_mid_fidelity_pass !== false && runtime.workflowTieredRequireMidFidelityPass !== false,
      final_verification_budget: Math.max(Number(provided.final_verification_budget || 1), 1),
      scoring_weights: {
        physics_pass: Number(provided?.scoring_weights?.physics_pass ?? 0.1),
        physics_safety_factor: Number(provided?.scoring_weights?.physics_safety_factor ?? 0.08),
        mid_fidelity_pass: Number(provided?.scoring_weights?.mid_fidelity_pass ?? 0.12),
        mid_fidelity_confidence: Number(provided?.scoring_weights?.mid_fidelity_confidence ?? 0.1),
      },
    };
  }

  function lineageDepth(lineage = {}) {
    const branchKey = String(lineage?.branch_key || 'main');
    return branchKey.split('/').filter(Boolean).length - 1;
  }

  function sumRetryCounts(counts = {}) {
    return Object.values(counts || {}).reduce((total, value) => total + Number(value || 0), 0);
  }

  function computeBranchScore(run = {}, context = {}) {
    const state = run.state_json || {};
    const policy = state.branch_policy || {};
    const weights = policy.score_weights || {};
    const cadResult = state.step_results?.cad || state.cad_manifest || {};
    const solverResult = state.step_results?.solver || state.solver_result || {};
    const lineage = state.lineage || {};
    const retries = sumRetryCounts(state.step_retry_counts || {});
    const noveltyHint = Number(run.metadata_json?.novelty_hint || state.branch_state?.novelty_hint || 0);
    const templateBias = Number(context.template_bias || 0);
    const evaluationPolicy = state.evaluation_policy || {};
    const evaluationWeights = evaluationPolicy.scoring_weights || {};
    const physicsResult = state.step_results?.physics_prescreen || {};
    const midResult = state.step_results?.mid_fidelity_analysis || {};
    const completion = run.status === 'completed' ? 1 : 0;
    const cadValid = cadResult?.validation?.valid === true ? 1 : (cadResult?.status === 'completed' ? 0.6 : 0);
    const manufacturable = cadResult?.manufacturable?.manufacturable === true ? 1 : (cadResult?.manufacturable?.manufacturable === false ? 0 : 0.4);
    const solverSuccess = solverResult?.status === 'completed' || solverResult?.ok === true ? 1 : (solverResult?.status === 'failed' ? 0 : 0.3);
    const physicsPass = physicsResult?.passed === true ? 1 : (physicsResult?.status === 'completed' ? 0.3 : 0);
    const physicsSafetyFactor = Math.min(Math.max(Number(physicsResult?.safety_factor_proxy || 0), 0), 3) / 3;
    const midFidelityPass = midResult?.passed === true ? 1 : (midResult?.status === 'completed' ? 0.35 : 0);
    const midFidelityConfidence = Math.min(Math.max(Number(midResult?.confidence || 0), 0), 1);
    const depthPenalty = Math.min(Math.max(lineageDepth(lineage), 0) * 0.03, 0.15);
    const retryPenalty = Math.min(retries * Number(weights.retries_penalty ?? 0.1), 0.35);
    const score = (
      completion * Number(weights.completion ?? 0.4)
      + cadValid * Number(weights.cad_valid ?? 0.15)
      + manufacturable * Number(weights.manufacturable ?? 0.15)
      + solverSuccess * Number(weights.solver_success ?? 0.2)
      + noveltyHint * Number(weights.novelty_hint ?? 0.1)
      + templateBias * Number(weights.template_bias ?? 0.05)
      + physicsPass * Number(evaluationWeights.physics_pass ?? 0.1)
      + physicsSafetyFactor * Number(evaluationWeights.physics_safety_factor ?? 0.08)
      + midFidelityPass * Number(evaluationWeights.mid_fidelity_pass ?? 0.12)
      + midFidelityConfidence * Number(evaluationWeights.mid_fidelity_confidence ?? 0.1)
      - retryPenalty
      - depthPenalty
    );
    return {
      value: Number(score.toFixed(4)),
      breakdown: {
        completion,
        cad_valid: cadValid,
        manufacturable,
        solver_success: solverSuccess,
        retry_penalty: Number(retryPenalty.toFixed(4)),
        novelty_hint: noveltyHint,
        template_bias: templateBias,
        physics_pass: physicsPass,
        physics_safety_factor: Number(physicsSafetyFactor.toFixed(4)),
        mid_fidelity_pass: midFidelityPass,
        mid_fidelity_confidence: Number(midFidelityConfidence.toFixed(4)),
        lineage_depth_penalty: Number(depthPenalty.toFixed(4)),
      },
    };
  }

  function getStepPolicy(run = {}, step) {
    return run.state_json?.definition?.steps?.[step] || {
      max_retries: Math.max(Number(runtime.workflowStepMaxRetries || 2), 0),
      retryable: true,
    };
  }

  function stepDedupeKey(runId, step, retryCounts = {}) {
    return `workflow:${runId}:step:${step}:attempt:${Number(retryCounts?.[step] || 0)}`;
  }

  async function updateRun(run, patch = {}, timelineEntry = null) {
    let baseRun = run && typeof run === 'object' ? run : await workflowStore.get(run);
    if (!baseRun) return null;

    for (let attempt = 0; attempt < 4; attempt += 1) {
      const expectedRevision = Number(baseRun.revision || 0);
      const builtPatch = buildRunPatch(baseRun, patch, timelineEntry);
      try {
        if (typeof workflowStore.updateConditional === 'function') {
          return await workflowStore.updateConditional(baseRun.run_id, expectedRevision, builtPatch);
        }
        return await workflowStore.update(baseRun.run_id, builtPatch);
      } catch (error) {
        if (error?.code !== 'WORKFLOW_REVISION_CONFLICT') throw error;
        const latest = error.current || await workflowStore.get(baseRun.run_id);
        if (!latest) throw error;
        baseRun = latest;
      }
    }

    const conflictError = new Error('Workflow update failed after repeated revision conflicts');
    conflictError.code = 'WORKFLOW_REVISION_CONFLICT';
    throw conflictError;
  }

  const stepPlugins = createWorkflowStepPluginRegistry({
    cad: {
      async dispatch({ run, actor, step }) {
        const current = await workflowStore.get(run.run_id);
        if (!current || current.state_json?.cad_execution_id || current.state_json?.cad_task_id) return { run: current, dispatched: false };
        const cadPlan = {
          ...(current.payload_json?.cad_plan || {}),
          project_id: current.project_id || current.payload_json?.cad_plan?.project_id || null,
          workflow_run_id: current.run_id,
          workflow_step: step,
        };
        const executionTarget = cadPlan.execution_target || runtime.cadExecutionTarget || 'queued';
        const retryCounts = current.state_json?.step_retry_counts || {};
        const dedupeKey = stepDedupeKey(current.run_id, step, retryCounts);

        if (executionTarget === 'in_process') {
          const manifest = await cadExecutionService.execute(cadPlan, actor, { executionTarget });
          const learningEvent = await learningStore.recordEvent({
            event_id: `cad-inline-${manifest.execution_id}`,
            domain: 'cad',
            project_id: manifest.project_id || null,
            actor_id: actor?.id || 'unknown',
            outcome_type: 'cad_execution',
            success_score: 1,
            confidence_score: manifest.validation?.valid ? 0.9 : 0.5,
            tags: ['cad', 'workflow'],
            input_json: cadPlan,
            output_json: manifest,
            metadata_json: { workflow_run_id: current.run_id },
          });
          await jobStore?.create('cad', {
            execution_id: manifest.execution_id,
            actor_id: manifest.actor_id,
            project_id: manifest.project_id,
            status: manifest.status,
            execution_target: executionTarget,
            learning_event_id: learningEvent.event_id,
            payload_json: cadPlan,
            result_json: manifest,
            progress_json: { percent: 100, stage: 'completed', detail: 'CAD execution completed inline' },
            metadata_json: { workflow_run_id: current.run_id },
          });
          const updated = await updateRun(current, {
            status: 'running',
            current_step: `${step}_completed`,
            state_json: {
              step_status: { [step]: 'completed' },
              cad_execution_id: manifest.execution_id,
              cad_manifest: manifest,
              step_results: { [step]: manifest },
              step_leases: { [step]: null },
              dispatch_keys: { [step]: dedupeKey },
              last_transition_at: nowIso(),
            },
          }, { at: nowIso(), type: 'step_completed', step, status: 'completed', related_id: manifest.execution_id, message: 'CAD completed inline' });
          return { run: updated, dispatched: true, immediate: true };
        }

        const manifest = cadExecutionService.buildQueuedManifest(cadPlan, actor, { executionTarget });
        const dispatch = buildExecutionAdapterPlan('cad', executionTarget, { execution_id: manifest.execution_id, plan: cadPlan }, runtime);
        manifest.dispatch = dispatch;
        await cadExecutionService.persistManifest(manifest);
        const task = await taskStore.submitTask({
          kind: 'cad',
          source_id: manifest.execution_id,
          execution_target: executionTarget,
          dedupe_key: dedupeKey,
          payload: { execution_id: manifest.execution_id, plan: cadPlan, dispatch },
          metadata: { project_id: manifest.project_id, workflow_run_id: current.run_id, workflow_step: step, dispatch, dedupe_key: dedupeKey },
        });
        await jobStore?.create('cad', {
          execution_id: manifest.execution_id,
          actor_id: manifest.actor_id,
          project_id: manifest.project_id,
          status: manifest.status,
          execution_target: executionTarget,
          task_id: task.task_id,
          payload_json: cadPlan,
          result_json: manifest,
          progress_json: manifest.progress || { percent: 5, stage: 'queued', detail: 'CAD execution queued' },
          metadata_json: { workflow_run_id: current.run_id, workflow_step: step, dispatch, dedupe_key: dedupeKey },
        });
        const updated = await updateRun(current, {
          status: 'running',
          current_step: `${step}_queued`,
          state_json: {
            step_status: { [step]: 'queued' },
            cad_execution_id: manifest.execution_id,
            cad_task_id: task.task_id,
            dispatch_keys: { [step]: dedupeKey },
            last_transition_at: nowIso(),
          },
        }, { at: nowIso(), type: step === 'cad' ? 'cad_queued' : 'step_queued', step, status: 'queued', related_id: task.task_id, message: 'CAD queued for worker execution' });
        return { run: updated, dispatched: true };
      },
      async reconcile({ run, actor, step }) {
        const state = run.state_json || {};
        const executionId = state.cad_execution_id || null;
        if (!executionId) return run;
        let manifest = state.cad_manifest || null;
        if (!manifest && typeof cadExecutionService.getStatus === 'function') manifest = cadExecutionService.getStatus(executionId);
        if (manifest?.status === 'completed') {
          return handleStepCompletedUnlocked(step, manifest, actor, { workflow_run_id: run.run_id });
        }
        if (state.cad_task_id) {
          const cadTask = await taskStore.getTask(state.cad_task_id);
          if (cadTask?.status === 'completed' && cadTask.result?.manifest) {
            return handleStepCompletedUnlocked(step, cadTask.result.manifest, actor, { workflow_run_id: run.run_id });
          }
          if (cadTask?.status === 'failed') {
            return markStepFailed(run, step, cadTask.error || 'CAD task failed', state.cad_task_id);
          }
        }
        return run;
      },
    },
    solver: {
      async dispatch({ run, actor, step }) {
        const current = await workflowStore.get(run.run_id);
        if (!current) return { run: current, dispatched: false };
        const existingSolverTaskId = current.state_json?.solver_task_id || null;
        if (current.state_json?.solver_job_id && existingSolverTaskId) {
          const existingTask = await taskStore.getTask(existingSolverTaskId);
          if (!existingTask || !isTaskTerminal(existingTask)) return { run: current, dispatched: false };
        }
        const cadResult = current.state_json?.step_results?.cad || current.state_json?.cad_manifest || {};
        const solverPayload = {
          ...(current.payload_json?.solver_payload || {}),
          project_id: cadResult.project_id || current.project_id || null,
          workflow_run_id: current.run_id,
          workflow_step: step,
          cad_execution_id: cadResult.execution_id || current.state_json?.cad_execution_id || null,
          cad_status: cadResult.status || null,
          cad_validation: cadResult.validation || null,
          cad_summary: cadResult.execution_summary || null,
        };
        const executionTarget = solverPayload.execution_target || runtime.solverExecutionTarget || 'queued';
        const retryCounts = current.state_json?.step_retry_counts || {};
        const dedupeKey = stepDedupeKey(current.run_id, step, retryCounts);
        const job = await solverJobService.submitJob(solverPayload, actor, { execution_target: executionTarget });

        if (executionTarget !== 'in_process') {
          const portableJob = JSON.parse(JSON.stringify({ ...job, worker_dispatch: null }));
          const dispatch = buildExecutionAdapterPlan('solver', executionTarget, { job_id: job.job_id, job: portableJob }, runtime);
          const task = await taskStore.submitTask({
            kind: 'solver',
            source_id: job.job_id,
            execution_target: executionTarget,
            dedupe_key: dedupeKey,
            payload: { job_id: job.job_id, job: portableJob, dispatch },
            metadata: { project_id: job.project_id, workflow_run_id: current.run_id, workflow_step: step, dispatch, dedupe_key: dedupeKey },
          });
          job.dispatch_task_id = task.task_id;
          await solverJobService.attachDispatch(job, dispatch);
          const updated = await updateRun(current, {
            status: 'running',
            current_step: `${step}_queued`,
            state_json: {
              step_status: { [step]: 'queued' },
              solver_job_id: job.job_id,
              solver_task_id: task.task_id,
              dispatch_keys: { [step]: dedupeKey },
              last_transition_at: nowIso(),
            },
          }, { at: nowIso(), type: step === 'solver' ? 'solver_queued' : 'step_queued', step, status: 'queued', related_id: task.task_id, message: 'Solver queued' });
          return { run: updated, dispatched: true };
        }

        const outcome = await solverJobService.runJobLocally(job, actor);
        const updated = await handleStepCompletedUnlocked(step, outcome.result, actor, { workflow_run_id: current.run_id, job: outcome.job });
        return { run: updated, dispatched: true, immediate: true };
      },
      async reconcile({ run, actor, step }) {
        const state = run.state_json || {};
        if (!state.solver_job_id) return run;
        const solverJob = await solverJobService.findJob(state.solver_job_id);
        if (solverJob?.result?.status || ['completed', 'failed'].includes(solverJob?.status)) {
          return handleStepCompletedUnlocked(step, solverJob.result || { status: solverJob.status }, actor, { workflow_run_id: run.run_id, job: solverJob });
        }
        if (state.solver_task_id) {
          const solverTask = await taskStore.getTask(state.solver_task_id);
          if (solverTask?.status === 'failed') {
            return markStepFailed(run, step, solverTask.error || 'Solver task failed', state.solver_task_id);
          }
        }
        return run;
      },
    },
    review: {
      async dispatch({ run, step }) {
        const cadPlan = run.payload_json?.cad_plan || {};
        const params = cadPlan.recipe?.parameters || {};
        const length = Math.max(Number(params.bracket_length_mm || params.length_mm || 50), 1);
        const width = Math.max(Number(params.bracket_width_mm || params.width_mm || 20), 1);
        const height = Math.max(Number(params.bracket_height_mm || params.height_mm || 10), 1);
        const hole = Math.max(Number(params.bolt_hole_diameter_mm || params.hole_diameter_mm || 5), 0);
        const aspectRatio = Number((length / Math.max(width, 1)).toFixed(4));
        const sectionRatio = Number((height / Math.max(width, 1)).toFixed(4));
        const holeToWidthRatio = Number((hole / Math.max(width, 1)).toFixed(4));
        const geometryValid = aspectRatio <= 8 && sectionRatio <= 6 && holeToWidthRatio <= 0.75;
        const result = {
          status: 'completed',
          workflow_run_id: run.run_id,
          workflow_step: step,
          review_type: 'combined',
          geometry_valid: geometryValid,
          manufacturable: geometryValid && width >= 4 && height >= 4,
          aspect_ratio: aspectRatio,
          section_ratio: sectionRatio,
          hole_to_width_ratio: holeToWidthRatio,
          passed: geometryValid && width >= 4 && height >= 4,
          completed_at: nowIso(),
        };
        const updated = await handleStepCompletedUnlocked(step, result, {}, { workflow_run_id: run.run_id });
        return { run: updated, dispatched: true, immediate: true };
      },
      async reconcile({ run }) {
        return run;
      },
    },
    review_geometry: {
      async dispatch({ run, step }) {
        const cadPlan = run.payload_json?.cad_plan || {};
        const params = cadPlan.recipe?.parameters || {};
        const length = Math.max(Number(params.bracket_length_mm || params.length_mm || 50), 1);
        const width = Math.max(Number(params.bracket_width_mm || params.width_mm || 20), 1);
        const height = Math.max(Number(params.bracket_height_mm || params.height_mm || 10), 1);
        const hole = Math.max(Number(params.bolt_hole_diameter_mm || params.hole_diameter_mm || 5), 0);
        const spanToDepth = Number((length / Math.max(height, 1)).toFixed(4));
        const widthToHoleClearance = Number(((width - hole) / Math.max(width, 1)).toFixed(4));
        const passed = spanToDepth <= 10 && widthToHoleClearance >= 0.15;
        const result = {
          status: 'completed',
          workflow_run_id: run.run_id,
          workflow_step: step,
          review_type: 'geometry',
          span_to_depth_ratio: spanToDepth,
          width_to_hole_clearance: widthToHoleClearance,
          passed,
          completed_at: nowIso(),
        };
        const updated = await handleStepCompletedUnlocked(step, result, {}, { workflow_run_id: run.run_id });
        return { run: updated, dispatched: true, immediate: true };
      },
      async reconcile({ run }) {
        return run;
      },
    },
    review_manufacturing: {
      async dispatch({ run, step }) {
        const cadPlan = run.payload_json?.cad_plan || {};
        const params = cadPlan.recipe?.parameters || {};
        const width = Math.max(Number(params.bracket_width_mm || params.width_mm || 20), 1);
        const height = Math.max(Number(params.bracket_height_mm || params.height_mm || 10), 1);
        const hole = Math.max(Number(params.bolt_hole_diameter_mm || params.hole_diameter_mm || 5), 0);
        const minFeature = Number(Math.min(width, height, Math.max(width - hole, 0)).toFixed(4));
        const stockFriendly = width <= 250 && height <= 250;
        const passed = minFeature >= 2 && stockFriendly;
        const result = {
          status: 'completed',
          workflow_run_id: run.run_id,
          workflow_step: step,
          review_type: 'manufacturing',
          min_feature_mm: minFeature,
          stock_friendly: stockFriendly,
          passed,
          completed_at: nowIso(),
        };
        const updated = await handleStepCompletedUnlocked(step, result, {}, { workflow_run_id: run.run_id });
        return { run: updated, dispatched: true, immediate: true };
      },
      async reconcile({ run }) {
        return run;
      },
    },
    noop: {
      async dispatch({ run, step }) {
        const result = {
          status: 'completed',
          workflow_run_id: run.run_id,
          workflow_step: step,
          synthetic: true,
          completed_at: nowIso(),
        };
        const updated = await handleStepCompletedUnlocked(step, result, {}, { workflow_run_id: run.run_id });
        return { run: updated, dispatched: true, immediate: true };
      },
      async reconcile({ run }) {
        return run;
      },
    },
    physics_prescreen: {
      async dispatch({ run, step }) {
        const cadPlan = run.payload_json?.cad_plan || {};
        const solverPayload = run.payload_json?.solver_payload || {};
        const params = cadPlan.recipe?.parameters || {};
        const loads = Array.isArray(solverPayload.loads) ? solverPayload.loads : [];
        const totalForce = loads.reduce((sum, load) => sum + Number(load?.magnitude_n || 0), 0);
        const length = Math.max(Number(params.bracket_length_mm || params.length_mm || 50), 1);
        const width = Math.max(Number(params.bracket_width_mm || params.width_mm || 20), 1);
        const height = Math.max(Number(params.bracket_height_mm || params.height_mm || 10), 1);
        const hole = Math.max(Number(params.bolt_hole_diameter_mm || params.hole_diameter_mm || 5), 0);
        const section = Math.max((width * height) - (Math.PI * (hole / 2) * (hole / 2)), 1);
        const stiffnessProxy = Number(((section * height) / length).toFixed(4));
        const stressProxy = Number((totalForce / section).toFixed(6));
        const safetyFactorProxy = Number((Math.max(stiffnessProxy, 0.001) / Math.max(stressProxy, 0.000001)).toFixed(4));
        const result = {
          status: 'completed',
          workflow_run_id: run.run_id,
          workflow_step: step,
          heuristic: true,
          total_force_n: totalForce,
          section_area_mm2: Number(section.toFixed(3)),
          stiffness_proxy: stiffnessProxy,
          stress_proxy: stressProxy,
          safety_factor_proxy: safetyFactorProxy,
          passed: safetyFactorProxy >= 1,
          completed_at: nowIso(),
        };
        const updated = await handleStepCompletedUnlocked(step, result, {}, { workflow_run_id: run.run_id });
        return { run: updated, dispatched: true, immediate: true };
      },
      async reconcile({ run }) {
        return run;
      },
    },
    mid_fidelity_analysis: {
      async dispatch({ run, step, actor }) {
        const inferred = inferPhysicsDomain(run);
        const domain = inferred.domain;
        const projectId = run.project_id || null;
        const source = domain === 'structural_static'
          ? { cad_plan: run.payload_json?.cad_plan || {}, solver_payload: run.payload_json?.solver_payload || {} }
          : buildPhysicsRequestForRun(run, domain);
        const prediction = await predictOutcome(learningStore, domain, source, projectId);
        if (prediction.early_reject === true) {
          const result = {
            status: 'skipped',
            skipped: true,
            workflow_run_id: run.run_id,
            workflow_step: step,
            domain,
            provider: 'predictive_gate',
            provider_selection_reason: 'predictive_early_reject',
            prediction,
            confidence: Number(prediction.confidence || 0),
            passed: false,
            completed_at: nowIso(),
          };
          const updated = await handleStepCompletedUnlocked(step, result, actor || {}, { workflow_run_id: run.run_id });
          return { run: updated, dispatched: true, immediate: true };
        }

        if (physicsJobService) {
          try {
            const physicsJob = await physicsJobService.submitJob({
              ...buildPhysicsRequestForRun(run, domain),
              execution_target: 'in_process',
              metadata: { workflow_run_id: run.run_id, workflow_step: step, physics_domain_reason: inferred.reason },
            }, actor || {}, { execution_target: 'in_process' });
            const solved = physicsJob?.result_json || physicsJob?.result || null;
            if (solved?.status === 'completed') {
              const result = {
                status: 'completed',
                workflow_run_id: run.run_id,
                workflow_step: step,
                provider: 'uare_physics',
                provider_selection_reason: domain === 'structural_static' ? 'structural_target_prefers_uare_physics' : `domain_route_${domain}` ,
                physics_domain: domain,
                physics_domain_reason: inferred.reason,
                model: solved.model || `${domain}_v1`,
                confidence: Number(solved.confidence || prediction.confidence || 0),
                passed: solved.passed === true,
                prediction,
                actual_cost_units: solved.actual_cost_units ?? null,
                actual_duration_ms: solved.actual_duration_ms ?? null,
                provenance: solved.provenance || { engine: 'uare_physics' },
                physics_job_id: physicsJob.job_id,
                completed_at: nowIso(),
                ...solved,
              };
              const updated = await handleStepCompletedUnlocked(step, result, actor || {}, { workflow_run_id: run.run_id });
              return { run: updated, dispatched: true, immediate: true };
            }
          } catch (error) {
          }
        }

        const fallback = {
          status: 'completed',
          workflow_run_id: run.run_id,
          workflow_step: step,
          heuristic: true,
          provider: 'internal_proxy',
          provider_selection_reason: domain === 'structural_static' ? 'structural_target_uare_physics_unavailable_fallback' : `domain_${domain}_internal_proxy_fallback`,
          physics_domain: domain,
          physics_domain_reason: inferred.reason,
          model: 'mid_fidelity_proxy_v2',
          confidence: Number(prediction.confidence || 0),
          passed: Number(prediction.pass_probability || 0) >= 0.5,
          prediction,
          completed_at: nowIso(),
        };
        if (domain === 'structural_static') {
          fallback.bending_stress_proxy = Number((prediction.features?.load_intensity || 0).toFixed(6));
          fallback.deflection_proxy = Number((prediction.features?.aspect_ratio || 0).toFixed(6));
          fallback.stability_index = Number((prediction.expected_score || 0).toFixed(6));
        } else if (domain === 'kinematics') {
          fallback.mobility_index = Number((prediction.features?.mobility_index || 0).toFixed(6));
          fallback.reachable_workspace_ratio = Number((prediction.features?.workspace_ratio || 0).toFixed(6));
          fallback.cycle_feasibility = Number((prediction.expected_score || 0).toFixed(6));
        } else if (domain === 'fluid_basic') {
          fallback.flow_efficiency = Number((prediction.expected_score || 0).toFixed(6));
          fallback.pressure_drop_proxy = Number((prediction.features?.length_to_diameter || 0).toFixed(6));
          fallback.cavitation_risk = Number((1 - prediction.pass_probability).toFixed(6));
        }
        const updated = await handleStepCompletedUnlocked(step, fallback, actor || {}, { workflow_run_id: run.run_id });
        return { run: updated, dispatched: true, immediate: true };
      },
      async reconcile({ run }) {
        return run;
      },
    },
    finalist_verification: {
      async dispatch({ run, step }) {
        const selection = await selectFinalistCandidate(run);
        if (!selection.selected) {
          const result = {
            status: 'skipped',
            skipped: true,
            workflow_run_id: run.run_id,
            workflow_step: step,
            reason: selection.reason,
            rank: selection.rank,
            family_size: selection.family_size,
            selected_run_ids: selection.selected_run_ids || [],
            branch_score: selection.score || null,
            completed_at: nowIso(),
          };
          const updated = await handleStepCompletedUnlocked(step, result, {}, { workflow_run_id: run.run_id });
          return { run: updated, dispatched: true, immediate: true };
        }
        const mid = run.state_json?.step_results?.mid_fidelity_analysis || {};
        const physics = run.state_json?.step_results?.physics_prescreen || {};
        const verificationScore = Number(Math.max(0, Math.min(1, (Number(mid.confidence || 0) * 0.6) + (Math.min(Number(physics.safety_factor_proxy || 0), 2) / 2) * 0.4)).toFixed(4));
        const result = {
          status: 'completed',
          workflow_run_id: run.run_id,
          workflow_step: step,
          expensive: true,
          verification_model: 'finalist_verification_v1',
          verification_score: verificationScore,
          finalist_rank: selection.rank,
          selected_run_ids: selection.selected_run_ids || [],
          family_size: selection.family_size,
          passed: verificationScore >= 0.6,
          completed_at: nowIso(),
        };
        const updated = await handleStepCompletedUnlocked(step, result, {}, { workflow_run_id: run.run_id });
        return { run: updated, dispatched: true, immediate: true };
      },
      async reconcile({ run }) {
        return run;
      },
    },
  });

  function getReadySteps(run = {}) {
    const definition = run.state_json?.definition || { ordered_steps: [], steps: {} };
    const stepStatus = run.state_json?.step_status || {};
    const ready = [];
    for (const step of definition.ordered_steps || []) {
      const status = stepStatus[step] || 'pending';
      if (status !== 'pending') continue;
      if (activeLeaseFor(run, step)) continue;
      const deps = definition.steps?.[step]?.depends_on || [];
      const depsSatisfied = deps.every((dep) => (stepStatus[dep] || 'pending') === 'completed' || (stepStatus[dep] || 'pending') === 'skipped');
      if (depsSatisfied) ready.push(step);
    }
    return ready;
  }

  function allStepsComplete(run = {}) {
    const definition = run.state_json?.definition || { ordered_steps: [] };
    const stepStatus = run.state_json?.step_status || {};
    return (definition.ordered_steps || []).every((step) => ['completed', 'skipped'].includes(stepStatus[step] || 'pending'));
  }

  async function leaseStep(run, step) {
    if (activeLeaseFor(run, step)) return run;
    return updateRun(run, {
      state_json: {
        step_leases: {
          [step]: {
            lease_token: crypto.randomBytes(8).toString('hex'),
            leased_at: nowIso(),
            lease_expires_at: new Date(Date.now() + stepLeaseMs).toISOString(),
          },
        },
        last_transition_at: nowIso(),
      },
    }, { at: nowIso(), type: 'step_leased', step, status: 'leased', message: 'Step lease acquired' });
  }

  async function finalizeRunIfComplete(run, actor = {}) {
    if (!run || isTerminalRun(run)) return run;
    if (!allStepsComplete(run)) return run;
    const stepResults = run.state_json?.step_results || {};
    const finalResult = {
      cad_execution_id: stepResults.cad?.execution_id || run.state_json?.cad_execution_id || null,
      solver_job_id: run.state_json?.solver_job_id || null,
      solver_result: stepResults.solver || run.state_json?.solver_result || null,
      step_results: stepResults,
    };
    let completed = await updateRun(run, {
      status: 'completed',
      current_step: 'workflow_completed',
      completed_at: nowIso(),
      result_json: finalResult,
      state_json: {
        last_transition_at: nowIso(),
      },
    }, { at: nowIso(), type: 'workflow_completed', status: 'completed', message: 'All workflow steps completed' });
    completed = await refreshBranchScoreUnlocked(completed);
    completed = await maybeAutoBranchUnlocked(completed, actor, 'completion');
    return completed;
  }

  async function markStepFailed(run, step, errorMessage = 'Step failed', relatedId = null) {
    const policy = getStepPolicy(run, step);
    const terminal = policy.terminal_on_failure !== false;
    let failed = await updateRun(run, {
      status: terminal ? 'failed' : 'running',
      current_step: `${step}_failed`,
      completed_at: terminal ? nowIso() : null,
      state_json: {
        step_status: { [step]: 'failed' },
        step_results: { [step]: { status: 'failed', error: errorMessage } },
        step_leases: { [step]: null },
        last_transition_at: nowIso(),
        [`${step}_error`]: errorMessage,
      },
    }, { at: nowIso(), type: 'workflow_failed', step, status: 'failed', related_id: relatedId, message: errorMessage });
    failed = await refreshBranchScoreUnlocked(failed);
    return failed;
  }

  async function dispatchStepUnlocked(run, step, actor = {}) {
    const definition = run.state_json?.definition || {};
    const stepDef = definition.steps?.[step] || {};
    const plugin = stepPlugins.get(stepDef.handler || step);
    if (!plugin?.dispatch) throw new Error(`No workflow step plugin registered for ${stepDef.handler || step}`);
    const leased = await leaseStep(run, step);
    return plugin.dispatch({ run: leased, actor, step, stepDef, runtime });
  }

  async function advanceRunUnlocked(runId, actor = {}) {
    let run = typeof runId === 'string' ? await workflowStore.get(runId) : runId;
    if (!run || isTerminalRun(run)) return run;

    run = await finalizeRunIfComplete(run, actor);
    if (isTerminalRun(run)) return run;

    const readySteps = getReadySteps(run).slice(0, parallelReadyStepLimit);
    if (!readySteps.length) return run;

    const results = await Promise.all(readySteps.map((step) => dispatchStepUnlocked(run, step, actor)));
    const refreshed = await workflowStore.get(run.run_id);
    if (results.some((entry) => entry?.immediate)) {
      return advanceRunUnlocked(refreshed, actor);
    }
    return refreshed;
  }

  async function handleStepCompletedUnlocked(step, payload = {}, actor = {}, context = {}) {
    const runId = context.workflow_run_id || payload.workflow_run_id || context.job?.payload?.workflow_run_id || null;
    if (!runId) return null;
    const run = await workflowStore.get(runId);
    if (!run) return null;
    const currentStatus = run.state_json?.step_status?.[step] || 'pending';
    if (currentStatus === 'completed') return finalizeRunIfComplete(run, actor);

    const patch = {
      status: 'running',
      current_step: `${step}_completed`,
      state_json: {
        step_status: { [step]: 'completed' },
        step_results: { [step]: payload },
        step_leases: { [step]: null },
        last_transition_at: nowIso(),
      },
    };

    if (step === 'cad') {
      patch.state_json.cad_execution_id = payload.execution_id || run.state_json?.cad_execution_id || null;
      patch.state_json.cad_manifest = payload;
    }
    if (step === 'solver') {
      patch.state_json.solver_job_id = context.job?.job_id || run.state_json?.solver_job_id || null;
      patch.state_json.solver_result = payload;
    }

    const completedStatus = payload?.status === 'skipped' || payload?.skipped === true ? 'skipped' : 'completed';
    patch.state_json.step_status = { [step]: completedStatus };
    const updated = await updateRun(run, patch, {
      at: nowIso(),
      type: step === 'cad' ? 'cad_completed' : step === 'solver' ? 'solver_completed' : completedStatus === 'skipped' ? 'step_skipped' : 'step_completed',
      step,
      status: payload?.status || completedStatus,
      related_id: payload.execution_id || context.job?.job_id || null,
      message: `${step} ${completedStatus} recorded`,
    });

    const scored = await refreshBranchScoreUnlocked(updated);
    return advanceRunUnlocked(scored, actor);
  }

  async function markStepForRetry(run, step, reason = 'Retry requested') {
    const state = clone(run.state_json || {});
    const counts = { ...(state.step_retry_counts || {}) };
    counts[step] = Number(counts[step] || 0) + 1;
    return updateRun(run, {
      status: 'running',
      completed_at: null,
      current_step: `${step}_retrying`,
      result_json: step === 'cad' ? null : run.result_json,
      state_json: {
        step_retry_counts: counts,
        step_status: { [step]: 'pending' },
        step_results: { [step]: null },
        step_leases: { [step]: null },
        dispatch_keys: { [step]: stepDedupeKey(run.run_id, step, counts) },
        last_transition_at: nowIso(),
        retry_requested_at: nowIso(),
      },
    }, {
      at: nowIso(),
      type: 'step_retry_requested',
      step,
      status: 'pending',
      message: reason,
    });
  }

  async function reconcileRunUnlocked(runId, actor = {}) {
    let run = typeof runId === 'string' ? await workflowStore.get(runId) : runId;
    if (!run) throw new Error('Workflow run not found');
    if (isTerminalRun(run)) return run;

    const definition = run.state_json?.definition || { ordered_steps: [], steps: {} };
    for (const step of definition.ordered_steps || []) {
      const status = run.state_json?.step_status?.[step] || 'pending';
      if (!['queued', 'running'].includes(status)) continue;
      const plugin = stepPlugins.get(definition.steps?.[step]?.handler || step);
      if (plugin?.reconcile) {
        run = await plugin.reconcile({ run, actor, step, runtime }) || run;
      }
    }

    const leases = run.state_json?.step_leases || {};
    const expired = Object.entries(leases).filter(([, lease]) => lease && isLeaseExpired(lease)).map(([step]) => step);
    if (expired.length) {
      const leasePatch = Object.fromEntries(expired.map((step) => [step, null]));
      const statusPatch = Object.fromEntries(expired.map((step) => [step, 'pending']));
      run = await updateRun(run, {
        state_json: {
          step_leases: leasePatch,
          step_status: statusPatch,
          last_transition_at: nowIso(),
        },
      }, { at: nowIso(), type: 'step_lease_expired', status: 'pending', message: `Released expired leases: ${expired.join(', ')}` });
    }

    return advanceRunUnlocked(run, actor);
  }

  async function recordMutationOutcomeUnlocked(run, context = {}) {
    if (!learningStore) return run;
    const current = typeof run === 'string' ? await workflowStore.get(run) : run;
    if (!current) return null;
    const lineage = current.state_json?.lineage || {};
    const branchState = current.state_json?.branch_state || {};
    const strategy = current.metadata_json?.mutation_strategy || current.metadata_json?.mutation_type || null;
    if (!lineage.parent_run_id || !strategy || branchState.mutation_feedback_recorded === true) return current;
    const domain = current.state_json?.physics_domain || inferPhysicsDomain(current).domain;
    const parentScore = Number(current.metadata_json?.parent_score || 0);
    const branchScore = current.state_json?.branch_score || computeBranchScore(current, context);
    const childScore = Number(branchScore?.value || 0);
    const scoreDelta = Number((childScore - parentScore).toFixed(4));
    const successScore = Math.max(0, Math.min(100, Math.round(((childScore + Math.max(scoreDelta, 0)) / 1.5) * 100)));
    await learningStore.recordEvent({
      domain: `mutation_${domain}`,
      project_id: current.project_id || null,
      outcome_type: 'mutation_result',
      success_score: successScore,
      confidence_score: Math.round(Math.min(100, 45 + ((current.metadata_json?.mutation_confidence || 0) * 40))),
      tags: [strategy, domain, current.status || 'active'],
      signals: {
        score_delta: scoreDelta,
        child_score: childScore,
        parent_score: parentScore,
      },
      input: {
        cad_plan: current.payload_json?.cad_plan || {},
        solver_payload: current.payload_json?.solver_payload || {},
      },
      output: {
        branch_score: branchScore,
        status: current.status,
      },
      metadata: {
        parent_run_id: lineage.parent_run_id,
        run_id: current.run_id,
        mutation_type: strategy,
      },
    });
    return updateRun(current, {
      state_json: {
        branch_state: {
          ...branchState,
          mutation_feedback_recorded: true,
          mutation_last_delta: scoreDelta,
          mutation_last_success_score: successScore,
        },
      },
    }, {
      at: nowIso(),
      type: 'mutation_feedback_recorded',
      status: current.status,
      message: `Recorded mutation outcome for ${strategy}`,
    });
  }

  async function buildLearnedChildInput(parent = {}, childInput = {}, lineageMode = 'branch') {
    const current = typeof parent === 'string' ? await workflowStore.get(parent) : parent;
    if (!current || !learningStore) return childInput;
    const domainInfo = inferPhysicsDomain(current);
    const insights = typeof learningStore.getInsights === 'function'
      ? await learningStore.getInsights({ domain: `mutation_${domainInfo.domain}`, projectId: current.project_id || null, limit: 120 })
      : { hints: {} };
    const mutationStrength = Number(current.state_json?.branch_policy?.mutation_strength || 1);
    const recommendation = await recommendMutation(learningStore, domainInfo.domain, {
      ...current,
      learning_hints: insights?.hints || {},
    }, current.project_id || null, mutationStrength);
    const cadPatch = deepMerge(recommendation.patch?.cad_plan_patch || {}, childInput.cad_plan_patch || {});
    const solverPatch = deepMerge(recommendation.patch?.solver_payload_patch || {}, childInput.solver_payload_patch || {});
    const metadataPatch = {
      ...(childInput.metadata_patch || {}),
      mutation_strategy: recommendation.mutation_type,
      mutation_confidence: recommendation.confidence,
      mutation_domain: recommendation.domain,
      mutation_sample_count: recommendation.sample_count,
      mutation_ranked_strategies: recommendation.ranked_strategies?.slice(0, 3) || [],
    };
    await learningStore.recordEvent({
      domain: `mutation_${domainInfo.domain}`,
      project_id: current.project_id || null,
      outcome_type: 'mutation_applied',
      success_score: 50,
      confidence_score: Math.round(Math.min(100, recommendation.confidence * 100)),
      tags: [recommendation.mutation_type, lineageMode, domainInfo.domain],
      signals: recommendation.features || {},
      input: {
        cad_plan: current.payload_json?.cad_plan || {},
        solver_payload: current.payload_json?.solver_payload || {},
      },
      output: {
        cad_plan_patch: cadPatch,
        solver_payload_patch: solverPatch,
      },
      metadata: {
        parent_run_id: current.run_id,
        mutation_type: recommendation.mutation_type,
      },
    });
    return {
      ...childInput,
      cad_plan_patch: cadPatch,
      solver_payload_patch: solverPatch,
      metadata_patch: metadataPatch,
    };
  }

  async function createChildRunUnlocked(parentRun, actor = {}, childInput = {}, lineageMode = 'branch') {
    const parent = typeof parentRun === 'string' ? await workflowStore.get(parentRun) : parentRun;
    if (!parent) throw new Error('Workflow run not found');
    childInput = await buildLearnedChildInput(parent, childInput, lineageMode);
    const parentState = parent.state_json || {};
    const lineage = parentState.lineage || {};
    const branchKeyBase = String(lineage.branch_key || 'main');
    const childBranchKey = lineageMode === 'reopen'
      ? `${branchKeyBase}/reopen-${Number((parentState.branch_state?.reopen_count || 0) + 1)}`
      : `${branchKeyBase}/${String(childInput.branch_key || `branch-${Number((parentState.branch_state?.created_children || []).length) + 1}`)}`;
    const mergedCadPlan = { ...(parent.payload_json?.cad_plan || {}), ...(childInput.cad_plan_patch || {}) };
    const mergedSolverPayload = { ...(parent.payload_json?.solver_payload || {}), ...(childInput.solver_payload_patch || {}) };
    const mergedOptions = {
      ...(parent.payload_json?.options || {}),
      branch_policy: {
        ...(parent.payload_json?.options?.branch_policy || {}),
        auto_branch_on_completion: false,
      },
      evaluation_policy: {
        ...(parent.payload_json?.options?.evaluation_policy || {}),
      },
      ...(childInput.options_patch || {}),
    };
    const childRun = await createRun({
      workflow_type: childInput.workflow_type || parent.workflow_type,
      project_id: childInput.project_id || parent.project_id,
      cad_plan: mergedCadPlan,
      solver_payload: mergedSolverPayload,
      requested_steps: childInput.requested_steps || parent.requested_steps,
      metadata: {
        ...(parent.metadata_json || {}),
        ...(childInput.metadata_patch || {}),
        parent_run_id: parent.run_id,
        parent_score: parentState.branch_score?.value ?? null,
      },
      lineage: {
        root_run_id: lineage.root_run_id || parent.run_id,
        parent_run_id: parent.run_id,
        branch_key: childBranchKey,
        reopen_of_run_id: lineageMode === 'reopen' ? parent.run_id : null,
      },
      options: mergedOptions,
    }, actor);

    const branchState = clone(parentState.branch_state || {});
    branchState.created_children = Array.isArray(branchState.created_children) ? branchState.created_children.slice() : [];
    branchState.reopened_runs = Array.isArray(branchState.reopened_runs) ? branchState.reopened_runs.slice() : [];
    if (lineageMode === 'reopen') {
      branchState.reopen_count = Number(branchState.reopen_count || 0) + 1;
      branchState.reopened_runs.push(childRun.run_id);
      branchState.last_reopened_at = nowIso();
    } else {
      branchState.created_children.push(childRun.run_id);
      branchState.last_branched_at = nowIso();
    }
    await updateRun(parent, { state_json: { branch_state: branchState, last_transition_at: nowIso() } }, {
      at: nowIso(),
      type: lineageMode === 'reopen' ? 'workflow_reopened' : 'workflow_branched',
      status: 'queued',
      related_id: childRun.run_id,
      message: lineageMode === 'reopen' ? 'Created reopened child workflow' : 'Created child workflow branch',
    });
    return childRun;
  }

  async function refreshBranchScoreUnlocked(run, context = {}) {
    const current = typeof run === 'string' ? await workflowStore.get(run) : run;
    if (!current) return null;
    const branchScore = computeBranchScore(current, context);
    const updated = await updateRun(current, {
      state_json: {
        branch_score: branchScore,
        branch_state: {
          ...(current.state_json?.branch_state || {}),
          last_scored_at: nowIso(),
        },
      },
    }, {
      at: nowIso(),
      type: 'branch_scored',
      status: current.status,
      message: `Branch score updated to ${branchScore.value}`,
    });
    return recordMutationOutcomeUnlocked(updated, context);
  }

  async function maybeAutoBranchUnlocked(run, actor = {}, trigger = 'completion') {
    const current = typeof run === 'string' ? await workflowStore.get(run) : run;
    if (!current) return null;
    const state = current.state_json || {};
    const policy = state.branch_policy || {};
    const branchState = state.branch_state || {};
    if (policy.enabled === false) return current;

    if (trigger === 'completion' && policy.auto_branch_on_completion === true) {
      const existingChildren = Array.isArray(branchState.created_children) ? branchState.created_children.length : 0;
      if (existingChildren >= Number(policy.max_children_per_run || 0)) return current;
      const score = state.branch_score?.value ?? computeBranchScore(current).value;
      if (score < Number(policy.min_score_to_branch || 0)) return current;
      const templates = Array.isArray(policy.templates) && policy.templates.length
        ? policy.templates.slice(0, Math.max(Number(policy.max_children_per_run || 0) - existingChildren, 0))
        : [];
      let latest = current;
      for (const template of templates) {
        await createChildRunUnlocked(latest, actor, template, 'branch');
        latest = await workflowStore.get(current.run_id);
      }
      return latest;
    }

    if (trigger === 'failure' && policy.auto_reopen_on_failure === true) {
      const reopenCount = Number(branchState.reopen_count || 0);
      if (reopenCount >= Number(policy.max_reopens_per_run || 0)) return current;
      if ((branchState.reopened_runs || []).length > reopenCount) return current;
      const failureStep = Object.entries(state.step_status || {}).find(([, status]) => status === 'failed')?.[0] || 'cad';
      const reopened = await createChildRunUnlocked(current, actor, {
        branch_key: `reopen-${reopenCount + 1}`,
        workflow_type: current.workflow_type,
        requested_steps: current.requested_steps,
        metadata_patch: { reopen_reason: `auto_reopen_after_${failureStep}_failure` },
        options_patch: { branch_policy: { ...policy, auto_reopen_on_failure: false } },
      }, 'reopen');
      return workflowStore.get(current.run_id);
    }

    return current;
  }



  async function buildPredictiveAssessment(runInput) {
    const run = typeof runInput === 'string' ? await workflowStore.get(runInput) : runInput;
    if (!run) return null;
    const inferred = inferPhysicsDomain(run);
    const source = inferred.domain === 'structural_static'
      ? { cad_plan: run.payload_json?.cad_plan || {}, solver_payload: run.payload_json?.solver_payload || {} }
      : buildPhysicsRequestForRun(run, inferred.domain);
    const prediction = await predictOutcome(learningStore, inferred.domain, source, run.project_id || null);
    const branchScore = run.state_json?.branch_score || computeBranchScore(run);
    const noveltyHint = Number(run.metadata_json?.novelty_hint || run.state_json?.branch_state?.novelty_hint || 0);
    const claimOpportunity = Number(run.state_json?.claim_intelligence?.opportunity_score || run.metadata_json?.claim_opportunity_score || 0);
    const informationGain = Number((prediction.information_gain ?? (1 - Math.abs(0.5 - Number(prediction.pass_probability || 0.5)) * 2)).toFixed(4));
    const uncertaintyPenalty = Number(prediction.uncertainty || 0) * 0.16;
    const predictedPriority = Number((
      (Number(prediction.pass_probability || 0) * 0.34)
      + (Number(prediction.expected_score || 0) * 0.24)
      + (informationGain * 0.14)
      + (Number(branchScore.value || 0) * 0.18)
      + (noveltyHint * 0.05)
      + (claimOpportunity * 0.09)
      - uncertaintyPenalty
    ).toFixed(4));
    return {
      run_id: run.run_id,
      domain: inferred.domain,
      domain_reason: inferred.reason,
      prediction,
      branch_score: branchScore,
      novelty_hint: noveltyHint,
      claim_opportunity: claimOpportunity,
      information_gain: informationGain,
      predicted_priority: predictedPriority,
      should_skip: prediction.early_reject === true,
    };
  }

  async function getPredictiveAssessment(runId) {
    return buildPredictiveAssessment(runId);
  }

  async function getLongHorizonPlan(runId) {
    const run = typeof runId === 'string' ? await workflowStore.get(runId) : runId;
    if (!run) return null;
    const assessment = await buildPredictiveAssessment(run);
    const family = await listBranchFamily(run);
    const betterSiblings = (family?.runs || []).filter((entry) => entry.run_id !== run.run_id).slice(0, 3).map((entry) => ({ run_id: entry.run_id, status: entry.status, branch_score: Number(entry.state_json?.branch_score?.value || 0) }));
    return {
      run_id: run.run_id,
      immediate: assessment.should_skip ? 'skip_or_reopen' : 'simulate_mid_fidelity',
      near_term: assessment.predicted_priority >= 0.6 ? 'prioritize_for_finalist_budget' : 'continue_branch_exploration',
      long_term: betterSiblings.length ? 'compete_with_family_topology' : 'expand_branch_family',
      predicted_priority: assessment.predicted_priority,
      uncertainty: Number(assessment.prediction?.uncertainty || 0),
      claim_opportunity: Number(assessment.claim_opportunity || 0),
      sibling_competitors: betterSiblings,
      domain: assessment.domain,
      information_gain: assessment.information_gain,
    };
  }

  async function getPortfolioOptimization(options = {}) {
    const runs = await workflowStore.list(Math.max(Number(options.limit || 1000), 1), {
      project_id: options.project_id || null,
      status: options.status || null,
    });
    const familiesByRoot = new Map();
    for (const entry of runs) {
      const rootRunId = entry.state_json?.lineage?.root_run_id || entry.run_id;
      if (!familiesByRoot.has(rootRunId)) familiesByRoot.set(rootRunId, []);
      familiesByRoot.get(rootRunId).push(entry);
    }
    const families = [];
    for (const [rootRunId, entries] of familiesByRoot.entries()) {
      const enrichedRuns = await Promise.all(entries.map(async (entry) => {
        const branchScore = entry.state_json?.branch_score || computeBranchScore(entry);
        const assessment = await buildPredictiveAssessment(entry);
        return {
          ...entry,
          branch_score: branchScore,
          predictive_assessment: assessment,
          predicted_priority: Number(assessment?.predicted_priority || branchScore?.value || 0),
        };
      }));
      families.push({ root_run_id: rootRunId, runs: enrichedRuns });
    }
    return optimizePortfolio(families, {
      totalBudgetUnits: options.totalBudgetUnits,
    });
  }

  async function listBranchFamily(runId) {
    const run = typeof runId === 'string' ? await workflowStore.get(runId) : runId;
    if (!run) return null;
    const rootRunId = run.state_json?.lineage?.root_run_id || run.run_id;
    const candidates = await workflowStore.list(1000, { project_id: run.project_id || null });
    const family = await Promise.all(candidates
      .filter((entry) => (entry.state_json?.lineage?.root_run_id || entry.run_id) === rootRunId)
      .map(async (entry) => {
        const branchScore = entry.state_json?.branch_score || computeBranchScore(entry);
        const assessment = await buildPredictiveAssessment(entry);
        return { ...entry, branch_score: branchScore, predictive_assessment: assessment, predicted_priority: assessment?.predicted_priority || Number(branchScore?.value || 0) };
      }));
    family.sort((a, b) => Number(b.predicted_priority || 0) - Number(a.predicted_priority || 0));
    return { root_run_id: rootRunId, runs: family };
  }


  async function selectFinalistCandidate(run = {}) {
    const current = typeof run === 'string' ? await workflowStore.get(run) : run;
    if (!current) return { selected: false, reason: 'run_not_found' };
    const state = current.state_json || {};
    const policy = state.evaluation_policy || buildEvaluationPolicy({});
    const physics = state.step_results?.physics_prescreen || {};
    const mid = state.step_results?.mid_fidelity_analysis || {};
    const currentScore = state.branch_score || computeBranchScore(current);
    if (policy.require_physics_pass && physics?.passed !== true) {
      return { selected: false, reason: 'physics_prescreen_failed', rank: null, score: currentScore };
    }
    if (policy.require_mid_fidelity_pass && mid?.passed !== true) {
      return { selected: false, reason: 'mid_fidelity_failed', rank: null, score: currentScore };
    }
    if (Number(currentScore?.value || 0) < Number(policy.min_branch_score_for_verification || 0)) {
      return { selected: false, reason: 'score_below_verification_threshold', rank: null, score: currentScore };
    }
    const family = await listBranchFamily(current);
    const runs = family?.runs || [current];
    const selectedRuns = runs.slice(0, Math.max(Number(policy.max_finalists_per_root || 1), 1));
    const rank = runs.findIndex((entry) => entry.run_id === current.run_id) + 1;
    const selected = selectedRuns.some((entry) => entry.run_id === current.run_id);
    return {
      selected,
      reason: selected ? 'selected_for_finalist_verification' : 'not_in_top_ranked_finalists',
      rank,
      score: currentScore,
      selected_run_ids: selectedRuns.map((entry) => entry.run_id),
      family_size: runs.length,
    };
  }

  async function createRun(input = {}, actor = {}) {
    const workflowType = input.workflow_type || 'cad_solver_pipeline';
    const definition = getWorkflowDefinition(workflowType, input.requested_steps || [], runtime);
    const retryPolicy = {
      auto_retry: input?.options?.auto_retry !== false,
      max_retries_per_step: Math.max(Number(input?.options?.max_retries_per_step || runtime.workflowStepMaxRetries || 2), 0),
      steps: Object.fromEntries((definition.ordered_steps || []).map((step) => [step, { ...definition.steps[step] }])),
    };
    const runId = input.run_id || makeRunId();
    const lineage = buildLineage({ ...input, run_id: runId }, actor);
    const branchPolicy = buildBranchPolicy(input);
    const evaluationPolicy = buildEvaluationPolicy(input);
    const run = await workflowStore.create({
      run_id: runId,
      workflow_type: workflowType,
      project_id: input.project_id || null,
      actor_id: actor?.id || 'unknown',
      status: 'queued',
      current_step: 'submitted',
      requested_steps: definition.ordered_steps,
      payload_json: { cad_plan: input.cad_plan || {}, solver_payload: input.solver_payload || {}, options: { ...(input.options || {}), branch_policy: branchPolicy, evaluation_policy: evaluationPolicy } },
      state_json: {
        definition,
        lineage,
        step_status: buildInitialStepStatus(definition),
        step_retry_counts: buildStepRetryCounts(definition),
        retry_policy: retryPolicy,
        branch_policy: branchPolicy,
        evaluation_policy: evaluationPolicy,
        branch_state: { created_children: [], reopened_runs: [], reopen_count: 0, selected: false },
        dispatch_keys: {},
        step_leases: {},
        step_results: {},
        timeline: [{ at: nowIso(), type: 'workflow_submitted', step: 'submitted', status: 'queued', message: 'Workflow submitted' }],
      },
      metadata_json: { ...(input.metadata || {}), lineage },
    });
    return startRun(run.run_id, actor);
  }

  async function startRun(runId, actor = {}) {
    return withRunLock(typeof runId === 'string' ? runId : runId?.run_id, () => advanceRunUnlocked(runId, actor));
  }

  async function handleCadCompleted(manifest = {}, actor = {}, context = {}) {
    const runId = context.workflow_run_id || manifest.workflow_run_id || null;
    if (!runId) return null;
    return withRunLock(runId, () => handleStepCompletedUnlocked(context.step || 'cad', manifest, actor, context));
  }

  async function handleSolverCompleted(job = {}, result = {}, actor = {}, context = {}) {
    const runId = context.workflow_run_id || job?.payload?.workflow_run_id || null;
    if (!runId) return null;
    return withRunLock(runId, () => handleStepCompletedUnlocked(context.step || 'solver', result, actor, { ...context, job }));
  }

  async function retryRun(runId, actor = {}, options = {}) {
    const resolvedRunId = typeof runId === 'string' ? runId : runId?.run_id;
    return withRunLock(resolvedRunId, async () => {
      const run = typeof runId === 'string' ? await workflowStore.get(runId) : runId;
      if (!run) throw new Error('Workflow run not found');
      const requestedStep = options.step || null;
      const state = run.state_json || {};
      const retryPolicy = state.retry_policy || {};
      const retryCounts = state.step_retry_counts || {};
      let step = requestedStep || Object.entries(state.step_status || {}).find(([, status]) => status === 'failed')?.[0] || (run.state_json?.definition?.entry_step || 'cad');
      const maxRetries = Number(getStepPolicy(run, step).max_retries ?? retryPolicy.max_retries_per_step ?? runtime.workflowStepMaxRetries ?? 2);
      if (Number(retryCounts[step] || 0) >= maxRetries) throw new Error(`Retry limit reached for ${step}`);
      const patched = await markStepForRetry(run, step, options.reason || `Retry requested for ${step}`);
      return advanceRunUnlocked(patched, actor);
    });
  }

  async function reconcileRun(runId, actor = {}) {
    const resolvedRunId = typeof runId === 'string' ? runId : runId?.run_id;
    return withRunLock(resolvedRunId, () => reconcileRunUnlocked(runId, actor));
  }

  async function sweepRuns(options = {}, actor = {}) {
    const limit = Math.max(Number(options.limit || runtime.workflowSweepBatchSize || 50), 1);
    const staleMs = Math.max(Number(options.stale_ms || runtime.workflowSweepStaleMs || 120000), 1000);
    const force = options.force === true;
    const autoRetry = options.auto_retry !== false;
    const runs = await workflowStore.list(limit, { status: options.status || null, project_id: options.project_id || null });
    const now = Date.now();
    const results = [];

    for (const run of runs) {
      if (isTerminalRun(run) && !force) continue;
      const lastAt = run.state_json?.last_transition_at || run.updated_at || run.created_at;
      const ageMs = lastAt ? Math.max(now - new Date(lastAt).getTime(), 0) : Number.MAX_SAFE_INTEGER;
      if (!force && ageMs < staleMs) continue;
      let after = run;
      let action = 'noop';
      try {
        after = await reconcileRun(run, actor);
        action = 'reconciled';
        const retryPolicy = after.state_json?.retry_policy || {};
        const allowAutoRetry = autoRetry && retryPolicy.auto_retry !== false;
        if (allowAutoRetry && after.status === 'failed') {
          const failedStep = Object.entries(after.state_json?.step_status || {}).find(([, status]) => status === 'failed')?.[0];
          if (failedStep) {
            const retryCounts = after.state_json?.step_retry_counts || {};
            const maxRetries = Number(getStepPolicy(after, failedStep).max_retries ?? retryPolicy.max_retries_per_step ?? runtime.workflowStepMaxRetries ?? 2);
            if (Number(retryCounts[failedStep] || 0) < maxRetries) {
              after = await retryRun(after, actor, { step: failedStep, reason: `Watchdog auto-retry for ${failedStep}` });
              action = 'retried';
            } else if (after.state_json?.branch_policy?.auto_reopen_on_failure === true) {
              after = await withRunLock(after.run_id, async () => {
                const latest = await workflowStore.get(after.run_id);
                await maybeAutoBranchUnlocked(latest, actor, 'failure');
                return workflowStore.get(after.run_id);
              });
              action = 'reopened';
            }
          }
        }
      } catch (error) {
        results.push({ run_id: run.run_id, status: 'error', action: 'error', error: error.message });
        continue;
      }
      results.push({ run_id: run.run_id, status: after.status, action, previous_status: run.status, current_step: after.current_step });
    }
    return { scanned: runs.length, affected: results.length, results };
  }

  async function branchRun(runId, actor = {}, options = {}) {
    const resolvedRunId = typeof runId === 'string' ? runId : runId?.run_id;
    return withRunLock(resolvedRunId, async () => {
      const run = typeof runId === 'string' ? await workflowStore.get(runId) : runId;
      if (!run) throw new Error('Workflow run not found');
      return createChildRunUnlocked(run, actor, options, 'branch');
    });
  }

  async function reopenRun(runId, actor = {}, options = {}) {
    const resolvedRunId = typeof runId === 'string' ? runId : runId?.run_id;
    return withRunLock(resolvedRunId, async () => {
      const run = typeof runId === 'string' ? await workflowStore.get(runId) : runId;
      if (!run) throw new Error('Workflow run not found');
      return createChildRunUnlocked(run, actor, options, 'reopen');
    });
  }

  async function updateBranchPolicy(runId, actor = {}, patch = {}) {
    const resolvedRunId = typeof runId === 'string' ? runId : runId?.run_id;
    return withRunLock(resolvedRunId, async () => {
      const run = typeof runId === 'string' ? await workflowStore.get(runId) : runId;
      if (!run) throw new Error('Workflow run not found');
      const nextPolicy = buildBranchPolicy({
        workflow_type: run.workflow_type,
        requested_steps: run.requested_steps,
        options: { branch_policy: { ...(run.state_json?.branch_policy || {}), ...(patch || {}) } },
      });
      const updated = await updateRun(run, {
        payload_json: {
          ...(run.payload_json || {}),
          options: { ...(run.payload_json?.options || {}), branch_policy: nextPolicy },
        },
        state_json: {
          branch_policy: nextPolicy,
          last_transition_at: nowIso(),
        },
      }, {
        at: nowIso(),
        type: 'branch_policy_updated',
        status: run.status,
        message: 'Branch policy updated',
      });
      return refreshBranchScoreUnlocked(updated);
    });
  }

  async function getBranchFamily(runId) {
    return listBranchFamily(runId);
  }

  async function listRuns(limit = 100, filters = {}) {
    return workflowStore.list(limit, filters);
  }

  return {
    createRun,
    startRun,
    handleCadCompleted,
    handleSolverCompleted,
    retryRun,
    reconcileRun,
    sweepRuns,
    getRun: workflowStore.get,
    listRuns,
    branchRun,
    reopenRun,
    updateBranchPolicy,
    getBranchFamily,
    getPredictiveAssessment,
    getLongHorizonPlan,
    getPortfolioOptimization,
    refreshBranchScore: refreshBranchScoreUnlocked,
    stepPlugins,
  };
}
