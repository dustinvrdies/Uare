import crypto from 'crypto';
import { createJsonFileStore } from '../utils/jsonFileStore.mjs';
import { withPgClient } from '../db/pg.mjs';

function nowIso() { return new Date().toISOString(); }
function clone(v) { return JSON.parse(JSON.stringify(v)); }
function missionId() { return `mission-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`; }
function versionId() { return `version-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`; }

function createFileMissionStore(runtime = {}) {
  const defaultFile = runtime.missionStoreFile || process.env.MISSION_STORE_FILE || './data/missions.json';
  const fileStore = createJsonFileStore(defaultFile, { missions: [], versions: [] });

  return {
    mode: 'file',
    async listByOwner(ownerId, projectId = null) {
      const db = fileStore.read();
      return db.missions.filter((entry) => entry.owner_id === String(ownerId) && (!projectId || entry.project_id === String(projectId))).sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')));
    },
    async create(input = {}) {
      let mission;
      fileStore.mutate((draft) => {
        mission = {
          mission_id: String(input.mission_id || missionId()),
          project_id: input.project_id ? String(input.project_id) : null,
          owner_id: String(input.owner_id || ''),
          title: String(input.title || 'Untitled mission'),
          brief: input.brief || null,
          status: input.status || 'draft',
          latest_run_id: input.latest_run_id || null,
          current_version_id: null,
          created_at: nowIso(),
          updated_at: nowIso(),
        };
        draft.missions.unshift(mission);
        const version = {
          version_id: versionId(), mission_id: mission.mission_id, owner_id: mission.owner_id,
          version_number: 1, label: input.label || 'v1', snapshot_json: clone(input.snapshot_json || {}),
          run_id: input.latest_run_id || null, created_at: nowIso(),
        };
        mission.current_version_id = version.version_id;
        draft.versions.unshift(version);
        return draft;
      });
      return clone(mission);
    },
    async get(missionIdValue) {
      const db = fileStore.read();
      const mission = db.missions.find((entry) => entry.mission_id === String(missionIdValue));
      if (!mission) return null;
      const versions = db.versions.filter((entry) => entry.mission_id === mission.mission_id).sort((a, b) => Number(b.version_number) - Number(a.version_number));
      return { ...clone(mission), versions };
    },
    async saveVersion(missionIdValue, input = {}) {
      let version;
      fileStore.mutate((draft) => {
        const mission = draft.missions.find((entry) => entry.mission_id === String(missionIdValue));
        if (!mission) return draft;
        const existing = draft.versions.filter((entry) => entry.mission_id === mission.mission_id);
        version = {
          version_id: versionId(), mission_id: mission.mission_id, owner_id: mission.owner_id,
          version_number: existing.length + 1, label: input.label || `v${existing.length + 1}`,
          snapshot_json: clone(input.snapshot_json || {}), run_id: input.run_id || null, created_at: nowIso(),
        };
        draft.versions.unshift(version);
        mission.updated_at = nowIso();
        mission.current_version_id = version.version_id;
        mission.latest_run_id = input.run_id || mission.latest_run_id || null;
        mission.status = input.status || mission.status;
        return draft;
      });
      return version ? clone(version) : null;
    },
  };
}

function createPostgresMissionStore(runtime = {}) {
  const connectionString = runtime.databaseUrl;
  return {
    mode: 'postgres',
    async listByOwner(ownerId, projectId = null) {
      return withPgClient(connectionString, async (client) => {
        const values = [String(ownerId)];
        let sql = 'select * from missions where owner_id=$1';
        if (projectId) {
          values.push(String(projectId));
          sql += ` and project_id=$${values.length}`;
        }
        sql += ' order by updated_at desc';
        const result = await client.query(sql, values);
        return result.rows;
      });
    },
    async create(input = {}) {
      const mission = {
        mission_id: String(input.mission_id || missionId()),
        project_id: input.project_id ? String(input.project_id) : null,
        owner_id: String(input.owner_id || ''),
        title: String(input.title || 'Untitled mission'),
        brief: input.brief || null,
        status: input.status || 'draft',
        latest_run_id: input.latest_run_id || null,
      };
      const version = {
        version_id: versionId(),
        mission_id: mission.mission_id,
        owner_id: mission.owner_id,
        version_number: 1,
        label: input.label || 'v1',
        snapshot_json: clone(input.snapshot_json || {}),
        run_id: input.latest_run_id || null,
      };
      await withPgClient(connectionString, async (client) => {
        await client.query('BEGIN');
        try {
          await client.query(`insert into missions (mission_id, project_id, owner_id, title, brief, status, latest_run_id, current_version_id, created_at, updated_at)
            values ($1,$2,$3,$4,$5,$6,$7,$8,now(),now())`, [mission.mission_id, mission.project_id, mission.owner_id, mission.title, mission.brief, mission.status, mission.latest_run_id, version.version_id]);
          await client.query(`insert into mission_versions (version_id, mission_id, owner_id, version_number, label, snapshot_json, run_id, created_at)
            values ($1,$2,$3,$4,$5,$6::jsonb,$7,now())`, [version.version_id, version.mission_id, version.owner_id, version.version_number, version.label, JSON.stringify(version.snapshot_json), version.run_id]);
          await client.query('COMMIT');
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        }
      });
      return this.get(mission.mission_id);
    },
    async get(missionIdValue) {
      return withPgClient(connectionString, async (client) => {
        const mission = (await client.query('select * from missions where mission_id=$1 limit 1', [String(missionIdValue)])).rows[0];
        if (!mission) return null;
        const versions = (await client.query('select * from mission_versions where mission_id=$1 order by version_number desc', [mission.mission_id])).rows;
        return { ...mission, versions };
      });
    },
    async saveVersion(missionIdValue, input = {}) {
      return withPgClient(connectionString, async (client) => {
        await client.query('BEGIN');
        try {
          const mission = (await client.query('select * from missions where mission_id=$1 limit 1 for update', [String(missionIdValue)])).rows[0];
          if (!mission) {
            await client.query('ROLLBACK');
            return null;
          }
          const nextNumber = Number((await client.query('select coalesce(max(version_number),0)+1 as next_version from mission_versions where mission_id=$1', [mission.mission_id])).rows[0]?.next_version || 1);
          const version = {
            version_id: versionId(),
            mission_id: mission.mission_id,
            owner_id: mission.owner_id,
            version_number: nextNumber,
            label: input.label || `v${nextNumber}`,
            snapshot_json: clone(input.snapshot_json || {}),
            run_id: input.run_id || null,
          };
          await client.query(`insert into mission_versions (version_id, mission_id, owner_id, version_number, label, snapshot_json, run_id, created_at)
            values ($1,$2,$3,$4,$5,$6::jsonb,$7,now())`, [version.version_id, version.mission_id, version.owner_id, version.version_number, version.label, JSON.stringify(version.snapshot_json), version.run_id]);
          await client.query(`update missions set updated_at=now(), current_version_id=$2, latest_run_id=coalesce($3, latest_run_id), status=coalesce($4, status) where mission_id=$1`, [mission.mission_id, version.version_id, input.run_id || null, input.status || null]);
          await client.query('COMMIT');
          return version;
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        }
      });
    },
  };
}

export function createMissionStore(runtime = {}) {
  return runtime.mode === 'postgres' ? createPostgresMissionStore(runtime) : createFileMissionStore(runtime);
}
