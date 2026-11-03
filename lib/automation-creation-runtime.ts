import { getAuthConfig } from "./auth/config";
import { readRuntimeHazeSession } from "./auth/runtime-session";
import { automationOwnerKey } from "./automation-owner";
import type { CreationBinding } from "./automation-creation";
export function assertCreationIdentity(binding:CreationBinding){const auth=readRuntimeHazeSession(),config=getAuthConfig();if(!auth||!config||auth.runtimeId!==binding.runtimeId||automationOwnerKey(config.issuer,auth.principal.subject)!==binding.ownerKey)throw new Error("创建会话的登录身份已变化，请重新打开创建入口。");}
