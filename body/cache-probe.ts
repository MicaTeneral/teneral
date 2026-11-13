import {createHash} from 'node:crypto';
export interface CacheProbe { inputBytes:number; commonPrefixBytes:number; previousInputBytes:number; staticEqual:boolean|null; comparable:boolean }
/** Only fixed-size digests survive a call. No request content is retained. */
export function cacheProbe() {
 let previous:string[]=[]; let previousBytes=0; let previousStatic='';
 const hash=(s:string|Uint8Array)=>createHash('sha256').update(s).digest('hex');
 return (body:Record<string,unknown>):CacheProbe=>{
  const {input,...fixed}=body;
  const bytes=Buffer.from(JSON.stringify(input));
  const digest=hash(JSON.stringify(fixed));
  // At most 4096 blocks retained (~4MiB coverage), including image requests.
  const blocks:string[]=[];
  for(let i=0;i+1024<=bytes.length&&blocks.length<4096;i+=1024) blocks.push(hash(bytes.subarray(i,i+1024)));
  let same=0;while(same<blocks.length&&same<previous.length&&blocks[same]===previous[same])same++;
  const result={inputBytes:bytes.length,commonPrefixBytes:same*1024,previousInputBytes:previousBytes,staticEqual:previousStatic?digest===previousStatic:null,comparable:previousStatic!==''};
  previous=blocks;previousBytes=bytes.length;previousStatic=digest;
  return result;
 };
}
