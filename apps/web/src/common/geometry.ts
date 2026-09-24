/** 通用几何类型：全项目（地图/POI/大地图/引擎）共享。 */

export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface Vec2 {
  readonly x: number;
  readonly y: number;
}

export interface Quaternion4 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly w: number;
}

export interface Euler3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}
