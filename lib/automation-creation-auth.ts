import { join,relative,resolve } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { automationAccess,DraftIdentityError } from "./automation-access";
import { getRpcSession } from "./rpc-manager";
import { resolveSessionPath,readSessionHeader } from "./session-reader";
/** Ordinary Pi sessions keep their existing access behavior; creation workspaces are owner scoped. */
export function creationOwnerFromCwd(cwd:string){const name=relative(join(getAgentDir(),"eureka-automation-drafts","creation-workspace"),resolve(cwd));return /^[a-f0-9]{64}$/.test(name)?name:null;}
export async function authorizeCreationSessionId(id:string){
  const live=getRpcSession(id),path=live?null:await resolveSessionPath(id),cwd=live?.cwd??(path?readSessionHeader(path)?.cwd:undefined);if(!cwd)return;
  const owner=creationOwnerFromCwd(cwd);if(!owner)return;const auth=await automationAccess();if(auth.ownerKey!==owner)throw new DraftIdentityError();auth.assertIdentity();
}
