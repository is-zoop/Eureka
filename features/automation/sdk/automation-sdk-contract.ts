import Ajv2020 from "ajv/dist/2020";
import contract from "./automation-sdk-contract.json";

const ajv = new Ajv2020({ allErrors: true, strict: false, validateFormats: false });
ajv.addSchema(contract, "eureka-sdk");
const validators = new Map<string, ReturnType<typeof ajv.compile>>();
export function assertSdkContract(definition: "automation" | "ui" | "workflow" | "browser" | "request", value: unknown) {
  let validate = validators.get(definition);
  if (!validate) { validate = ajv.compile({ $ref: `eureka-sdk#/$defs/${definition}` }); validators.set(definition, validate); }
  if (!validate(value)) throw new Error(`SDK ${contract.sdkVersion} ${definition} 声明无效：${validate.errors?.slice(0, 4).map(error => `${error.instancePath || "/"} ${error.message}`).join("；")}`);
}
export function sdkContractSummary() { return { sdkVersion: contract.sdkVersion, capabilities: contract.capabilities, methods: contract.methods, limits: contract.limits }; }
