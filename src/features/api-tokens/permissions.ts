export const permissionGroupsByApp = {
  "buaa-classhopper": [
    {
      code: "reservations",
      name: "签到预约",
      permissions: [
        { code: "reservations:read", name: "读取签到预约详情" },
        { code: "reservations:result:write", name: "回传签到结果" },
      ],
    },
  ],
} as const;

export type PermissionApp = keyof typeof permissionGroupsByApp;
export type PermissionFor<A extends PermissionApp> =
  (typeof permissionGroupsByApp)[A][number]["permissions"][number]["code"];

export function appPermissionGroups(appId: string) {
  return Object.prototype.hasOwnProperty.call(permissionGroupsByApp, appId)
    ? permissionGroupsByApp[appId as PermissionApp]
    : [];
}

export function appPermissions(appId: string): readonly string[] {
  return appPermissionGroups(appId).flatMap((group) => group.permissions.map((permission) => permission.code));
}
