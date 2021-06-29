import {
    OpenAPIObject,
    OperationObject,
    ParameterObject,
    ReferenceObject,
    SchemaObject
} from 'openapi3-ts'

export function isReferenceObject(param: ParameterObject | ReferenceObject): param is ReferenceObject {
    return (param as ReferenceObject).$ref !== undefined;
}

export function getReference(param: ReferenceObject, spec: OpenAPIObject): SchemaObject {
    const refBasePath = '#/components/schemas/';

    if (param.$ref.startsWith(refBasePath)) {
        const refName = param.$ref.substring(0, refBasePath.length);
        return spec.components.schemas[refName] as SchemaObject;
    }

    throw new Error('Can\'t follow $refs outside of #/components/schemas/ at present')
}

export function getParameter(spec: OpenAPIObject, param: ParameterObject | ReferenceObject): ParameterObject|SchemaObject {
    return (isReferenceObject(param))
        ? getReference(param, spec)
        : param;
}

export function isParamRequired(spec: OpenAPIObject, param: ParameterObject | ReferenceObject): boolean {
    if (isReferenceObject(param)) {
        const resolvedRef = getReference(param, spec);
        return !resolvedRef.nullable;
    }
    else {
        return param.required;
    }
}
