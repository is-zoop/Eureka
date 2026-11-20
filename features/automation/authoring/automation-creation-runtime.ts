import { assertLocalAutomationNamespace } from "../runtime/automation-local-context";
import type { CreationBinding } from "./automation-creation";
export function assertCreationIdentity(binding:CreationBinding){assertLocalAutomationNamespace(binding.ownerKey);}
