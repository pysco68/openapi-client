import * as YAML from 'js-yaml'
import { OpenAPIObject, OperationObject } from 'openapi3-ts'

export interface SpecOptions {
  /**
   * A base ref string to ignore when expanding ref dependencies e.g. '#/definitions/'
   */
   ignoreRefType?: string
}

export function resolveSpec(src: string | Object, options?: SpecOptions): Promise<OpenAPIObject> {
  if (!options) options = {}
  if (typeof src === 'string') {
    return loadJson(src).then(spec => formatSpec(spec, src, options))
  } else {
    return Promise.resolve(formatSpec(<OpenAPIObject> src, null, options))
  }
}

function loadJson(src: string): Promise<OpenAPIObject> {
  if (/^https?:\/\//im.test(src)) {
    return fetch(src).then(response => response.json())
  } else if (String(process) === '[object process]') {
    return readFile(src).then(contents => parseFileContents(contents, src))
  } else {
    throw new Error(`Unable to load api at '${src}'`)
  }
}

function readFile(filePath: string): Promise<string> {
  return new Promise((res, rej) =>
    require('fs').readFile(filePath, 'utf8', (err, contents) =>
      err ? rej(err) : res(contents)))
}

function parseFileContents(contents: string, path: string): OpenAPIObject {
  return /.ya?ml$/i.test(path)
    ? YAML.load(contents) as OpenAPIObject
    : JSON.parse(contents) as OpenAPIObject
}

function formatSpec(spec: OpenAPIObject, src?: string, options?: SpecOptions): OpenAPIObject {
  if (!spec.basePath) spec.basePath = ''
  else if (spec.basePath.endsWith('/')) spec.basePath = spec.basePath.slice(0, -1)

  if (src && /^https?:\/\//im.test(src)) {
    const parts = src.split('/')
    if (!spec.host) spec.host = parts[2]
    if (!spec.schemes || !spec.schemes.length) spec.schemes = [parts[0].slice(0, -1)]
  } else {
    if (!spec.host) spec.host = 'localhost'
    if (!spec.schemes || !spec.schemes.length) spec.schemes = ['http']
  }

  const s: any = spec
  if (!s.produces || !s.produces.length) {
    s.accepts = [ 'application/json' ] // give sensible default
  } else {
    s.accepts = s.produces
  }

  if (!s.consumes) s.contentTypes = []
  else s.contentTypes = s.consumes

  delete s.consumes
  delete s.produces

  return <OpenAPIObject>expandRefs(spec, spec, options)
}

/**
 * Recursively expand internal references in the form `#/path/to/object`.
 *
 * @param {object} data the object to search for and update refs
 * @param {object} lookup the object to clone refs from
 * @param {regexp=} refMatch an optional regex to match specific refs to resolve
 * @returns {object} the resolved data object
 */
export function expandRefs(data: any, lookup: Object, options: SpecOptions): any {
  if (!data) return data

  /*if (Array.isArray(data)) {
    return data.map(item => expandRefs(item, lookup, options))
  } else if (typeof data === 'object') {
    if (dataCache.has(data)) return data
    if (data.$ref && !(options.ignoreRefType && data.$ref.startsWith(options.ignoreRefType))) {
      const resolved = expandRef(data.$ref, lookup)
      delete data.$ref
      data = Object.assign({}, resolved, data)
    }
    dataCache.add(data)
    for (let name in data) {
      data[name] = expandRefs(data[name], lookup, options)
    }
  }*/
  return data
}

function expandRef(ref: string, lookup: Object): any {
  const parts = ref.split('/')
  if (parts.shift() !== '#' || !parts[0]) {
    throw new Error(`Only support JSON Schema $refs in format '#/path/to/ref'`)
  }
  let value = lookup
  while (parts.length) {
    value = value[parts.shift()]
    if (!value) throw new Error(`Invalid schema reference: ${ref}`)
  }
  return value
}

const dataCache = new Set()
