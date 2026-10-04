// 本家 (Java 製) の出力順を再現するためのヘルパ

/** java.lang.String#hashCode */
export function javaStringHash(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
  return h;
}

/**
 * java.util.HashSet<String> に items を (重複除去して) 追加した後の反復順を返す。
 * バケット番号の昇順、同じバケット内は追加順。容量は 16 から負荷率 0.75 で倍々に増える。
 * (リサイズは同一バケット内の相対順を保つので、最終容量での安定ソートと等価)
 */
export function hashSetOrder(items) {
  const uniq = [...new Set(items)];
  let cap = 16;
  while (uniq.length > cap * 0.75) cap *= 2;
  const bucket = (s) => {
    const h = javaStringHash(s);
    return ((h ^ (h >>> 16)) & (cap - 1));
  };
  return uniq
    .map((s, i) => ({ s, i, b: bucket(s) }))
    .sort((x, y) => x.b - y.b || x.i - y.i)
    .map((x) => x.s);
}
