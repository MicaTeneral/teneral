import type { Provider } from '../brain/provider';
import type { Tool } from './tools';
import { retrieveSources, validateSources } from './sources';
import { subagents } from './subagent';

/** Host-selected immutable sources, not autonomous browsing. */
export function research(provider: Provider, send: typeof fetch = fetch): Tool {
  return {
    spec: {name:'research', description:'Fetch 1–3 parent-selected public GitHub files at immutable commits, then run 1–3 parallel no-tools analyses. Each job selects one source by zero-based index. Fixed origin, no credentials/redirects, 15s retrieval deadline, 16KB/file and 32KB total. Rejects context overflow without truncation. Workers have 60s local deadlines; remote cost and transport memory are not bounded. Returns host provenance separately from untrusted worker claims.', parameters:{type:'object',properties:{
      sources:{type:'array',minItems:1,maxItems:3,items:{type:'object',properties:{repository:{type:'string'},commit:{type:'string'},path:{type:'string'}},required:['repository','commit','path']}},
      jobs:{type:'array',minItems:1,maxItems:3,items:{type:'object',properties:{label:{type:'string'},task:{type:'string'},source:{type:'integer'}},required:['label','task','source']}},
    },required:['sources','jobs']}},
    async run(args, ctx, signal) {
      signal?.throwIfAborted();
      const a = args as {sources?:unknown; jobs?:unknown} | null;
      const sources = validateSources(a?.sources);
      if (!Array.isArray(a?.jobs) || !a.jobs.length || a.jobs.length > 3) throw new Error('Provide 1–3 jobs');
      const labels = new Set<string>();
      const jobs = a.jobs.map(j => {
        if (!j || typeof j.label !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(j.label) || labels.has(j.label)
          || typeof j.task !== 'string' || !j.task.trim() || j.task.length > 2000
          || !Number.isInteger(j.source) || j.source < 0 || j.source >= sources.length) throw new Error('Invalid research job');
        labels.add(j.label);
        return {label:j.label as string, task:j.task as string, source:j.source as number};
      });
      const evidence = await retrieveSources(sources, send, 15000, signal);
      signal?.throwIfAborted();
      const batch = jobs.map(j => ({label:j.label,task:j.task,context:JSON.stringify(evidence[j.source])}));
      // JSON escaping and repeated sources count toward the actual worker context budget.
      if (batch.some(j => j.context.length > 20000) || batch.reduce((n,j)=>n+j.task.length+j.context.length,0)>44000) throw new Error('Retrieved evidence exceeds worker context budget; select smaller files or fewer jobs. No workers launched.');
      const result = JSON.parse(await subagents(provider).run({jobs:batch},ctx,signal));
      return JSON.stringify({sources:evidence.map(({text, ...provenance})=>provenance), assignments:jobs.map(({label,source})=>({label,source})), ...result});
    },
  };
}
