/** Compare the version format accepted by isAppVersion, without loading packages. */
export function compareAppVersions(a: string, b: string): number {
  const number = (left: string, right: string) => {
    left = left.replace(/^0+(?=\d)/, ""); right = right.replace(/^0+(?=\d)/, "");
    return left.length === right.length ? (left === right ? 0 : left < right ? -1 : 1) : left.length < right.length ? -1 : 1;
  };
  const parts = (value: string) => { const dash = value.indexOf("-"); return { core: (dash < 0 ? value : value.slice(0, dash)).split("."), pre: dash < 0 ? null : value.slice(dash + 1).split(".") }; };
  const left = parts(a), right = parts(b);
  for (let i = 0; i < 3; i++) { const order = number(left.core[i], right.core[i]); if (order) return order; }
  if (!left.pre || !right.pre) return left.pre === right.pre ? 0 : left.pre ? -1 : 1;
  for (let i = 0; i < Math.max(left.pre.length, right.pre.length); i++) {
    const x = left.pre[i], y = right.pre[i]; if (x === undefined || y === undefined) return x === y ? 0 : x === undefined ? -1 : 1;
    if (x === y) continue;
    const xn = /^\d+$/.test(x), yn = /^\d+$/.test(y);
    const order = xn && yn ? number(x, y) : xn !== yn ? xn ? -1 : 1 : x < y ? -1 : 1;
    if (order) return order;
  }
  return 0;
}
export function latestAppVersion(versions: { version: string }[]) { return versions.reduce((latest, item) => compareAppVersions(item.version, latest) > 0 ? item.version : latest, versions[0].version); }
