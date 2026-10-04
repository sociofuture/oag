// 言語非依存の命名ヘルパ

export function words(str) {
  return String(str)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);
}

export function camelize(str, lowerFirst = false) {
  const parts = String(str).split(/[^A-Za-z0-9]+/).filter(Boolean);
  let s = parts.map((p) => p[0].toUpperCase() + p.slice(1)).join('');
  if (lowerFirst && s) s = lowerFirstChar(s);
  return s;
}

export function lowerFirstChar(s) {
  // "URLValue" のような連続大文字は先頭の塊を小文字化する (openapi-generator と同様)
  const m = /^([A-Z]+)(?=[A-Z][a-z])/.exec(s);
  if (m) return m[1].toLowerCase() + s.slice(m[1].length);
  return s.charAt(0).toLowerCase() + s.slice(1);
}

export function upperFirstChar(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function underscore(str) {
  return words(str).map((w) => w.toLowerCase()).join('_');
}

/** CheckIPAddress -> check_ip_address, getPetById -> get_pet_by_id */
export function snake(str) {
  return String(str)
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .join('_')
    .toLowerCase();
}

export function upperSnake(str) {
  return words(str).map((w) => w.toUpperCase()).join('_');
}
