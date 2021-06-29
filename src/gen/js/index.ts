import genOperations from './genOperations'
import genReduxActions from './genReduxActions'
import genService from './genService'
import genTypes from './genTypes'
import genSpec from './genSpec'
import { applyFormatOptions } from './support'
import { OpenAPIObject, OperationObject } from 'openapi3-ts'

export default function genCode(spec: OpenAPIObject, operations: OperationObject[], options: ClientOptions): OpenAPIObject {
  applyFormatOptions(options)
  genService(options)
  genSpec(spec, options)
  genOperations(spec, operations, options)
  genTypes(spec, options)
  if (options.redux) genReduxActions(spec, operations, options)
  return spec
}
