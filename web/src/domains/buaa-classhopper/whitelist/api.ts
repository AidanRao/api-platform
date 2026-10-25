import { policyConfigSchema, type PolicyConfig } from "../../../../../src/domains/buaa-classhopper/access-policy/schema";
import { createAdminClient, jsonRequest } from "../../../platform/api";

const request = createAdminClient("buaa-classhopper"), path = "/v1/iclass/access-policy";
export const fetchPolicy = (signal?: AbortSignal) => request(path, policyConfigSchema, { signal });
export const savePolicy = (input: PolicyConfig) => request(path, policyConfigSchema, jsonRequest("PUT", input));
