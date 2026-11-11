// Where the applications tracker goes (config/tracker.json `publisher`):
//   bikeshed  (default) one private document updated in place through the project-local
//             bikeshed CLI (adapters/bikeshed.mjs): publish, update, comments, reply, resolve.
//             Folder, doc id and url live in tracker.json `bikeshed`; never the bikeshed root.
//   local     <data>/tracker/tracker.html only: no comments, no review documents. Every publish
//             reports published: false and the path.
//
// trackerPublisher({ cfg, run }) -> { kind, cfg, publish({ html, file, st, title }), comments(doc),
//   reply(doc, thread, text), resolve(doc, thread) }
// publish resolves the publishTracker result: status created | updated | unchanged | comments |
// auth | refused | no-folder | error (bikeshed), or local.
//
// Review documents (one per job's tailored CV and letter) are listed in
// <data>/tracker/review-docs.json lists the review documents of tailored CVs and letters, per job.
// scripts/tailor.mjs writes one document per part:
//   { "<job_id>": { "cv": { "doc_id", "url", "version_id" }, "letter": { ... }, "updated_at" } }
// The older flat form { "<job_id>": { "doc_id", "url" } } is still read (part "docs"). The comment
// watch (scripts/tracker-watch.mjs) polls every part listed; reviewParts() flattens both forms.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DATA_DIR } from '../paths.mjs';
import { loadConfig } from '../config.mjs';
import { bikeshedRun, isAuthError, parseJsonOut } from './bikeshed.mjs';
import { publishTracker } from '../tracker.mjs';

export const trackerDir = (dataDir = DATA_DIR) => join(dataDir, 'tracker');
export const reviewDocsPath = (dataDir = DATA_DIR) => join(trackerDir(dataDir), 'review-docs.json');

const writeJson = (p, obj) => {
  mkdirSync(dirname(p), { recursive: true });
  const tmp = `${p}.tmp-${process.pid}`;
  writeFileSync(tmp, `${JSON.stringify(obj, null, 2)}\n`);
  renameSync(tmp, p);
};

export function loadReviewDocs(path = reviewDocsPath()) {
  if (!existsSync(path)) return {};
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8'));
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  } catch { return {}; }
}
export function setReviewDoc(jobId, { doc_id, url = null }, path = reviewDocsPath()) {
  if (!doc_id) throw new Error('a review doc needs doc_id');
  const all = loadReviewDocs(path);
  all[String(jobId)] = { doc_id, url };
  writeJson(path, all);
  return all;
}
// Every review document of one registry entry: [{ part, doc_id, url, version_id }].
export function reviewParts(entry) {
  if (!entry || typeof entry !== 'object') return [];
  if (entry.doc_id) return [{ part: 'docs', doc_id: entry.doc_id, url: entry.url || null, version_id: entry.version_id || null }];
  return ['cv', 'letter'].filter((k) => entry[k]?.doc_id).map((k) => ({ part: k, doc_id: entry[k].doc_id, url: entry[k].url || null, version_id: entry[k].version_id || null }));
}

export function dropReviewDoc(jobId, path = reviewDocsPath()) {
  const all = loadReviewDocs(path);
  delete all[String(jobId)];
  writeJson(path, all);
  return all;
}

// The flat bikeshed settings publishTracker takes, from tracker.json's `bikeshed` block.
export const bikeshedCfg = (cfg = {}) => {
  const b = cfg.bikeshed || {};
  return { folder_id: b.folder_id ?? null, doc_id: b.doc_id ?? null, url: b.url ?? null, letters_folder_id: b.letters_folder_id ?? null, reviews_folder_id: b.reviews_folder_id ?? null };
};

const status = (r) => (r.code === 0 ? 'ok' : r.code === 127 ? 'error' : isAuthError(r) ? 'auth' : 'refused');

export function trackerPublisher({ cfg = loadConfig('tracker.json', { required: false }), run = bikeshedRun, dataDir = DATA_DIR } = {}) {
  const kind = cfg.publisher === 'local' ? 'local' : 'bikeshed';
  const bs = bikeshedCfg(cfg);
  if (kind === 'local') {
    const path = join(trackerDir(dataDir), 'tracker.html');
    const off = async () => ({ status: 'local', published: false, path });
    return {
      kind, cfg: bs, run: null, path,
      async publish({ html, st = {} }) {
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, html);
        return { status: 'local', published: false, path, cfg: bs, st };
      },
      comments: async () => ({ status: 'local', threads: [] }),
      reply: off,
      resolve: off,
    };
  }
  return {
    kind, cfg: bs, run,
    publish: ({ html, file, st = {}, title = cfg.title || 'Job hunt · Applications' }) => publishTracker({ html, file, cfg: bs, st, run, title }),
    async comments(doc = bs.doc_id) {
      if (!doc) return { status: 'no-doc', threads: [] };
      const r = await run(['comments', doc, '--json']);
      return { status: status(r), threads: r.code === 0 ? parseJsonOut(r.stdout)?.threads || [] : [], message: r.code === 0 ? null : String(r.stderr || '').trim() };
    },
    async reply(doc, thread, text) {
      const r = await run(['reply', doc, thread, text, '--json']);
      return { status: status(r), message: r.code === 0 ? null : String(r.stderr || '').trim() };
    },
    async resolve(doc, thread) {
      const r = await run(['resolve', doc, thread, '--json']);
      return { status: status(r), message: r.code === 0 ? null : String(r.stderr || '').trim() };
    },
  };
}
