import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const documentPath = resolve(root, 'tests/fixtures/sonik-booking/booking-openapi.fixture.json');
const artifactsPath = resolve(root, 'tests/fixtures/generated/sonik-booking-command-artifacts.generated.json');
const outputPath = resolve(root, 'tests/fixtures/generated/sonik-booking-runtime-bindings.generated.json');
const runtimeOutputPath = resolve(root, 'apps/standalone-sveltekit/src/lib/server/generated/sonik-booking-runtime-bindings.generated.json');
const outputPaths = [outputPath, runtimeOutputPath];
const checkMode = process.argv.includes('--check');
const httpMethods = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'options']);

const document = JSON.parse(await readFile(documentPath, 'utf8'));
const artifacts = JSON.parse(await readFile(artifactsPath, 'utf8'));
const operationsByMethodPath = new Map();
for (const [path, pathItem] of Object.entries(document.paths ?? {})) {
  for (const [method, operation] of Object.entries(pathItem ?? {})) {
    if (!httpMethods.has(method.toLowerCase())) continue;
    operationsByMethodPath.set(`${method.toUpperCase()} ${path}`, { method: method.toUpperCase(), path, operation });
  }
}

const generatedAt = artifacts.generatedAt;
const sourceCommands = artifacts.catalog.commands;
const mountedCommands = sourceCommands.filter((command) => command.metadata?.sourceMounted === true);
const shadowCommands = sourceCommands.filter((command) => command.metadata?.sourceMounted !== true);
const bindings = mountedCommands.map((command) => {
  const method = String(command.transport?.method ?? 'GET').toUpperCase();
  const path = command.transport?.path ?? '/';
  const operationEntry = operationsByMethodPath.get(`${method} ${path}`);
  if (!operationEntry) throw new Error(`No OpenAPI operation for generated command ${command.id} (${method} ${path})`);
  const operation = operationEntry.operation;
  const parameters = Array.isArray(operation.parameters) ? operation.parameters : [];
  const pathParams = parameters.filter((parameter) => parameter?.in === 'path').map(parameterBinding);
  const queryParams = parameters.filter((parameter) => parameter?.in === 'query').map(parameterBinding);
  const headerParams = parameters.filter((parameter) => parameter?.in === 'header').map(parameterBinding);
  const cookieParams = parameters.filter((parameter) => parameter?.in === 'cookie').map(parameterBinding);
  const requestBody = requestBodyBinding(operation.requestBody);
  const status = command.effect === 'read' ? 'mounted-read' : 'mounted-write';
  return {
    commandId: command.id,
    operationId: operation.operationId ?? command.transport?.procedure ?? command.id,
    method,
    path,
    effect: command.effect,
    approval: command.approval,
    familyId: command.familyId,
    status,
    pathParams,
    queryParams,
    headerParams,
    cookieParams,
    requestBody,
    auth: {
      required: true,
      orgScoped: true,
      scopes: command.effect === 'read' ? ['booking:read'] : ['booking:write'],
    },
    commit: command.effect !== 'read',
    destructive: command.effect === 'destructive',
  };
});

const summary = {
  sourceCommandCount: sourceCommands.length,
  commandCount: bindings.length,
  shadowCommandCount: shadowCommands.length,
  shadowCommandIds: shadowCommands.map((command) => command.id).sort(),
  readCount: bindings.filter((binding) => binding.effect === 'read').length,
  writeCount: bindings.filter((binding) => binding.effect === 'write').length,
  destructiveCount: bindings.filter((binding) => binding.effect === 'destructive').length,
  mountedReadCount: bindings.filter((binding) => binding.status === 'mounted-read').length,
  mountedWriteCount: bindings.filter((binding) => binding.status === 'mounted-write').length,
};

const output = {
  version: 'sonik-agent-ui.booking-runtime-bindings.v1',
  generatedAt,
  provider: 'sonik-booking-openapi-runtime',
  source: artifacts.source,
  summary,
  bindings,
};
const serializedOutput = `${JSON.stringify(output, null, 2)}\n`;

if (checkMode) {
  for (const currentOutputPath of outputPaths) {
    let existingOutput = '';
    try {
      existingOutput = await readFile(currentOutputPath, 'utf8');
    } catch (error) {
      console.error(`Generated booking runtime binding artifact is missing: ${currentOutputPath}`);
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
    if (existingOutput !== serializedOutput) {
      console.error(`Generated booking runtime binding artifact is stale: ${currentOutputPath}`);
      console.error('Run pnpm generate:runtime:sonik-booking and commit the updated artifact.');
      process.exit(1);
    }
    console.log(`Checked ${currentOutputPath}`);
  }
} else {
  for (const currentOutputPath of outputPaths) {
    await writeFile(currentOutputPath, serializedOutput);
    console.log(`Wrote ${currentOutputPath}`);
  }
}
console.log(JSON.stringify(output.summary));

function parameterBinding(parameter) {
  const schema = parameter?.schema && typeof parameter.schema === 'object' ? parameter.schema : {};
  return {
    name: String(parameter.name),
    required: parameter.required === true || parameter.in === 'path',
    schema: compactSchema(schema),
    enum: Array.isArray(schema.enum) ? schema.enum.map(String) : undefined,
  };
}

function requestBodyBinding(requestBody) {
  if (!requestBody || typeof requestBody !== 'object') return { required: false, contentTypes: [], preferredContentType: null, bodyEncoding: 'none' };
  const content = requestBody.content && typeof requestBody.content === 'object' ? requestBody.content : {};
  const contentTypes = Object.keys(content).sort();
  const preferredContentType = choosePreferredContentType(contentTypes);
  return {
    required: requestBody.required === true,
    contentTypes,
    preferredContentType,
    bodyEncoding: bodyEncodingForContentType(preferredContentType),
  };
}

function choosePreferredContentType(contentTypes) {
  if (contentTypes.includes('application/json')) return 'application/json';
  if (contentTypes.includes('multipart/form-data')) return 'multipart/form-data';
  if (contentTypes.includes('application/octet-stream')) return 'application/octet-stream';
  return contentTypes[0] ?? null;
}

function bodyEncodingForContentType(contentType) {
  if (!contentType) return 'none';
  if (contentType === 'application/json' || contentType.endsWith('+json')) return 'json';
  if (contentType === 'multipart/form-data') return 'multipart';
  if (contentType === 'application/octet-stream') return 'binary';
  return 'unsupported';
}


function compactSchema(schema) {
  const out = {};
  for (const key of ['type', 'format', 'description', 'minimum', 'maximum', 'minLength', 'maxLength']) {
    if (schema[key] !== undefined) out[key] = schema[key];
  }
  if (Array.isArray(schema.enum)) out.enum = schema.enum;
  return out;
}
