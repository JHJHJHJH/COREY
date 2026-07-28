/**
 * Shared web-ifc surface for server-side IFC processing (writeback, version
 * compare). web-ifc is loaded dynamically so the module only pays the WASM
 * cost when a route actually needs it.
 */

export type WebIfcModule = {
  IfcAPI: new () => IfcApiInstance;
};

export type IfcWrappedValue = {
  name?: string;
  type?: number;
  value?: unknown;
};

export type IfcPropertyLine = {
  Name?: unknown;
  NominalValue?: IfcWrappedValue | null;
};

export type IfcPropertySetLine = {
  Name?: unknown;
  HasProperties?: unknown[];
  expressID?: number;
};

export type IfcPlacedGeometry = {
  geometryExpressID: number;
  flatTransformation: number[];
};

export type IfcFlatMesh = {
  expressID: number;
  geometries: {
    size: () => number;
    get: (index: number) => IfcPlacedGeometry;
  };
  delete?: () => void;
};

export type IfcGeometry = {
  GetVertexData: () => number;
  GetVertexDataSize: () => number;
  delete?: () => void;
};

export type IfcApiInstance = {
  properties: {
    getPropertySets: (
      modelId: number,
      elementId: number,
      recursive?: boolean,
      includeTypeProperties?: boolean,
    ) => Promise<unknown[]>;
  };
  SetWasmPath: (path: string, absolute?: boolean) => void;
  Init: () => Promise<void>;
  OpenModel: (bytes: Uint8Array, settings?: { COORDINATE_TO_ORIGIN?: boolean }) => number;
  GetLine: (modelId: number, expressId: number, flatten?: boolean, inverse?: boolean) => unknown;
  GetLineIDsWithType: (
    modelId: number,
    type: number,
    includeInherited?: boolean,
  ) => { size: () => number; get: (index: number) => number };
  GetLineType: (modelId: number, expressId: number) => number;
  GetNameFromTypeCode: (type: number) => string;
  GetTypeCodeFromName: (typeName: string) => number;
  StreamAllMeshes: (
    modelId: number,
    callback: (mesh: IfcFlatMesh, index: number, total: number) => void,
  ) => void;
  GetGeometry: (modelId: number, geometryExpressId: number) => IfcGeometry;
  GetVertexArray: (pointer: number, size: number) => Float32Array;
  CreateIfcEntity: (modelId: number, type: number, ...args: unknown[]) => unknown;
  CreateIfcType: (modelId: number, type: number, value: unknown) => unknown;
  CreateIFCGloballyUniqueId: (modelId: number) => unknown;
  WriteLine: (modelId: number, line: unknown) => void;
  SaveModel: (modelId: number) => Uint8Array;
  CloseModel: (modelId: number) => void;
};

export async function loadWebIfc(): Promise<WebIfcModule> {
  return (await import("web-ifc")) as unknown as WebIfcModule;
}

export function readWrappedValue(value: unknown) {
  if (value && typeof value === "object" && "value" in value) {
    return (value as IfcWrappedValue).value;
  }

  return value;
}
