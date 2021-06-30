import { writeFileSync, join, groupOperationsByGroupName, camelToUppercase, getBestResponse } from '../util'
import { DOC, SP, ST, getDocType, getTSParamType, getParamTypeName } from './support'
import { OpenAPIObject, OperationObject, ParameterObject, SecurityRequirementObject, SchemaObject, RequestBodyObject } from 'openapi3-ts'
import { getRequestBodyObject, getReference, isParamRequired, isReferenceObject, isRequestBodyObject } from './helpers'

export default function genOperations(spec: OpenAPIObject, operations: OperationObject[], options: ClientOptions) {
  const files = genOperationGroupFiles(spec, operations, options)
  files.forEach(file => writeFileSync(file.path, file.contents))
}

export function genOperationGroupFiles(spec: OpenAPIObject, operations: OperationObject[], options: ClientOptions) {  
  const groups = groupOperationsByGroupName(operations)
  const files = []
  for (let name in groups) {
    const group = groups[name]
    const lines = []
    join(lines, renderHeader(name, spec, options))
    join(lines, renderOperationGroup(group, renderOperation, spec, options))
    if (options.language === 'ts') {
      join(lines, renderOperationGroup(group, renderOperationParamType, spec, options))
    }
    join(lines, renderOperationGroup(group, renderOperationInfo, spec, options))

    files.push({
      path: `${options.outDir}/${name}.${options.language}`,
      contents: lines.join('\n')
    })
  }
  return files
}

function renderHeader(name: string, spec: OpenAPIObject, options: ClientOptions): string[] {
  const lines = []
  if (spec.definitions && options.language === 'ts') {
    lines.push(`/// <reference path="types.ts"/>`)
  }
  lines.push(`/** @module ${name} */`)
  lines.push(`// Auto-generated, edits will be overwritten`)
  lines.push(`import * as gateway from './gateway'${ST}`)
  lines.push(`import * as types from './types'${ST}`)
  lines.push('')
  return lines
}

export function renderOperationGroup(group: any[], func: any, spec: OpenAPIObject, options: ClientOptions): string[] {
  return group
    .map(op => func.call(this, spec, op, options))
    .reduce((a, b) => a.concat(b))
}

function renderOperation(spec: OpenAPIObject, op: OperationObject, options: ClientOptions): string[] {
  const lines = []
  join(lines, renderOperationDocs(spec, op))
  join(lines, renderOperationBlock(spec, op, options))
  return lines
}

function renderOperationDocs(spec: OpenAPIObject, op: OperationObject): string[] {
  const lines = []
  lines.push(`/**`)
  join(lines, renderDocDescription(op))
  join(lines, renderDocParams(spec, op))
  lines.push(` */`)
  return lines
}

function renderDocDescription(op: OperationObject) {
  const desc = op.description || op.summary
  return desc ? `${DOC}${desc.trim()}`.replace(/\n/g, `\n${DOC}`).split('\n') : []
}

function renderDocParams(spec: OpenAPIObject, op: OperationObject) {
  const params = op.parameters
  
  const required = params.filter(param => isParamRequired(spec, param))
  const optional = params.filter(param => !isParamRequired(spec, param))
  const lines = []
  
  join(lines, required.map(renderDocParam))  
  if (optional.length) {
    lines.push(`${DOC}@param {object} options Optional options`)
    join(lines, optional.map(renderDocParam))
  }
  if (op.description || op.summary) {
    lines.unshift(DOC)
  }
  
  // we have a body to send as well...
  if(op.requestBody) {
    lines.push(`${DOC}@param {${op.id}_request} body`)
  }
  
  lines.push(renderDocReturn(op))
  return lines
}

function renderDocParam(param) {
  let name = getParamName(param.name)
  let description = (param.description || '').trim().replace(/\n/g, `\n${DOC}${SP}`)
  if (!param.required) {
    name = `options.${name}`
    if (param.default) name += `=${param.default}`
    name = `[${name}]`
  }
  if (param.enum && param.enum.length) {
    description = `Enum: ${param.enum.join(', ')}. ${description}`
  }
  return `${DOC}@param {${getDocType(param)}} ${name} ${description}`
}

function renderDocReturn(op:OperationObject): string {
  const response = getBestResponse(op)
  
  let description = response ? response.description || '' : ''
  description = description.trim().replace(/\n/g, `\n${DOC}${SP}`)

  const contentType = response.content && typeof response.content['application/json'];

  // if nothing goes, we return objects...
  if (response.code == 'default' || contentType !== 'object')
    return `${DOC}@return {Promise<$tipi$ApiResponse<object>>} ${description}`;

  // get the type name and/or generate it form the op id
  const contentDef = response.content['application/json'];
  const name = getParamTypeName(contentDef, `${op.id}_response`) 
  return `${DOC}@return {Promise<$tipi$ApiResponse<${name}>>} ${description}`
}

function renderOperationBlock(spec: OpenAPIObject, op: OperationObject, options: ClientOptions): string[] {
  const lines = []
  join(lines, renderOperationSignature(spec, op, options))
  join(lines, renderOperationObject(spec, op, options))
  join(lines, renderRequestCall(op, options))
  lines.push('')
  return lines
}

function renderOperationSignature(spec: OpenAPIObject, op: OperationObject, options: ClientOptions): string[] {
  const paramSignature = renderParamSignature(spec, op, options)
  const rtnSignature = renderReturnSignature(op, options)
  return [ `export function ${op.id}(${paramSignature})${rtnSignature} {` ]
}

export function renderParamSignature(spec: OpenAPIObject, op: OperationObject, options: ClientOptions, pkg?: string): string {
  //const params = op.parameters

  const required = Array<ParameterObject|SchemaObject|RequestBodyObject>();
  const optional = Array<ParameterObject|SchemaObject|RequestBodyObject>();

  for(const param of op.parameters) {
    if(isReferenceObject(param)) {
      const resolvedRef = getReference(param, spec);
      if(resolvedRef.nullable)
        required.push(resolvedRef);
      else
        optional.push(resolvedRef);
    }
    else {
      if(param.required)
        required.push(param);
      else
        optional.push(param);
    }
  }

  // check if we have a body to send
  if(op.requestBody) {
    const resolved = getRequestBodyObject(spec, op.requestBody)
    required.push(resolved)
  }  

  //const required = params.filter(param => param.required)
  //const optional = params.filter(param => !param.required)
  const funcParams = renderRequiredParamsSignature(required, options)
  const optParam = renderOptionalParamsSignature(op, optional, options, pkg)
  if (optParam.length) funcParams.push(optParam)

  return funcParams.map(p => p.join(': ')).join(', ')
}

function renderRequiredParamsSignature(required: (ParameterObject|SchemaObject|RequestBodyObject)[], options: ClientOptions): string[][] {
  return required.reduce<string[][]>((a, param) => {
    a.push(getParamSignature(param, options))
    return a
  }, [])
}

function renderOptionalParamsSignature(op: OperationObject, optional: (ParameterObject|SchemaObject|RequestBodyObject)[], options: ClientOptions, pkg?: string) {
  if (!optional.length) return []
  if (!pkg) pkg = ''
  const s = options.language === 'ts' ? '?' : ''
  const param = [`options${s}`]
  if (options.language === 'ts') param.push(`${pkg}${op.id[0].toUpperCase() + op.id.slice(1)}Options`)
  return param
}

function renderReturnSignature(op: OperationObject, options: ClientOptions): string {
  if (options.language !== 'ts') return ''
  const response = getBestResponse(op)
  return `: Promise<api.Response<${getTSParamType(response)}>>`
}

function getParamSignature(param: ParameterObject|SchemaObject|RequestBodyObject, options: ClientOptions): string[] {
  if(isRequestBodyObject(param)) {
    return ['body'];  // there's just one name for that...
  }
  else {
    const signature = [getParamName(param.name)]
    if (options.language === 'ts') signature.push(getTSParamType(param))
    return signature
  }
}

export function getParamName(name: string): string {
  const parts = name.split(/[_-\s!@\#$%^&*\(\)]/g).filter(n => !!n)
  const reduced = parts.reduce((name, p) => `${name}${p[0].toUpperCase()}${p.slice(1)}`)
  return escapeReservedWords(reduced)
}

function escapeReservedWords(name: string): string {
  let escapedName = name

  const reservedWords = [
    'break',
    'case',
    'catch',
    'class',
    'const',
    'continue',
    'debugger',
    'default',
    'delete',
    'do',
    'else',
    'export',
    'extends',
    'finally',
    'for',
    'function',
    'if',
    'import',
    'in',
    'instanceof',
    'new',
    'return',
    'super',
    'switch',
    'this',
    'throw',
    'try',
    'typeof',
    'var',
    'void',
    'while',
    'with',
    'yield'
  ]

  if (reservedWords.indexOf(name) >= 0) {
    escapedName = name + '_'
  }
  return escapedName
}

function renderOperationObject(spec: OpenAPIObject, op: OperationObject, options: ClientOptions): string[] {
  const lines = []

  const parameters = op.parameters.reduce(groupParams, {})
  const names = Object.keys(parameters)
  var last = names.length - 1

  // if we have to append the body property we actually need to append the , separator on every iteration
  // so we flip that logic to alway be false...
  if(op.requestBody) last = -1;  

  names.forEach((name, i) => {
    join(lines, renderParamGroup(name, parameters[name], i === last))
  })

  if(op.requestBody) {
    lines.push(`${SP}${SP}body: body`);
  }

  if (lines.length) {
    if (options.language === 'ts') {
      lines.unshift(`${SP}const parameters: api.OperationParamGroups = {`)
    } else {
      lines.unshift(`${SP}const parameters = {`)
    }
    lines.push(`${SP}}${ST}`)
    const hasOptionals = op.parameters.some(param => !isParamRequired(spec, param))
    if (hasOptionals) lines.unshift(`${SP}if (!options) options = {}${ST}`)
  }
  return lines
}

function groupParams(groups: any, param: ParameterObject): any {
  const group = groups[param.in] || []
  const name = getParamName(param.name)
  const realName = /^[_$a-z0-9]+$/gim.test(param.name) ? param.name : `'${param.name}'`
  const value = param.required ? name : 'options.' + name

  if (param.type === 'array') {
    if (!param.collectionFormat) throw new Error(`param ${param.name} must specify an array collectionFormat`)
    const str = `gateway.formatArrayParam(${value}, '${param.collectionFormat}', '${param.name}')`
    group.push(`${SP.repeat(3)}${realName}: ${str}`)
  } else if (param.format === 'date' || param.format === 'date-time') {
    const str = `gateway.formatDate(${value}, '${param.format}')`
    group.push(`${SP.repeat(3)}${realName}: ${str}`)
  } else if (param.required && param.name === name && name === realName) {
    group.push(`${SP.repeat(3)}${realName}`)
  } else {
    group.push(`${SP.repeat(3)}${realName}: ${value}`)
  }
  groups[param.in] = group
  return groups
}

function renderParamGroup(name: string, groupLines: string[], last: boolean): string[] {
  const lines = []
  lines.push(`${SP.repeat(2)}${name}: {`)
  join(lines, groupLines.join(',\n').split('\n'))
  lines.push(`${SP.repeat(2)}}${last ? '' : ','}`)
  return lines
}

function renderRequestCall(op: OperationObject, options: ClientOptions) { 
  const params = (op.parameters.length || op.requestBody) ? ', parameters': ''
  return [ `${SP}return gateway.request(${op.id}Operation${params})${ST}`, '}' ]
}

function renderOperationParamType(spec: OpenAPIObject, op: OperationObject, options: ClientOptions): string[] {
  const optional = op.parameters.filter(param => !isParamRequired(spec, param))
  if (!optional.length) return []
  const lines = []
  lines.push(`export interface ${op.id[0].toUpperCase() + op.id.slice(1)}Options {`)
  optional.forEach(paramObj => {
    
    // retriefe the $ref or use param directly
    const param = (isReferenceObject(paramObj)) 
      ? getReference(paramObj, spec) 
      : paramObj;

    if (param.description) {
      lines.push(`${SP}/**`)
      lines.push(`${SP}${DOC}` + (param.description || '').trim().replace(/\n/g, `\n${SP}${DOC}${SP}`))
      lines.push(`${SP} */`)
    }
    lines.push(`${SP}${getParamName(param.name)}?: ${getTSParamType(param)}${ST}`)
  })
  lines.push('}')
  lines.push('')
  return lines
}

// We could just JSON.stringify this stuff but want it looking as if typed by developer
function renderOperationInfo(spec: OpenAPIObject, op: OperationObject, options: ClientOptions): string[] {
  const lines = []
  if (options.language === 'ts') {
    lines.push(`const ${op.id}Operation: api.OperationInfo = {`)
  } else {
    lines.push(`const ${op.id}Operation = {`)
  }
  lines.push(`${SP}path: '${op.path}',`)

  const hasBody = op.requestBody
  if (hasBody) {
    
    if(isRequestBodyObject(hasBody)) {
      const contentTypes = Object.keys(hasBody.content).join("', '")
      lines.push(`${SP}contentTypes: [ '${contentTypes}' ],`)
    }
    else {

    }

    
  }
  lines.push(`${SP}method: '${op.method}'${op.security ? ',': ''}`)
  if (op.security && op.security.length) {
    const secLines = renderSecurityInfo(op.security)
    lines.push(`${SP}security: [`)
    join(lines, secLines)
    lines.push(`${SP}]`)
  }
  lines.push(`}${ST}`)
  lines.push('')
  return lines
}

function renderSecurityInfo(security: SecurityRequirementObject[]): string[] {
  return security.map((sec, i) => {
    const scopes = sec.scopes
    const secLines = []
    secLines.push(`${SP.repeat(2)}{`)
    secLines.push(`${SP.repeat(3)}id: '${sec.id}'${scopes ? ',': ''}`)
    if (scopes) {
      secLines.push(`${SP.repeat(3)}scopes: ['${scopes.join(`', '`)}']`)
    }
    secLines.push(`${SP.repeat(2)}}${i + 1 < security.length ? ',': ''}`)
    return secLines
  }).reduce((a, b) => a.concat(b))
}
