// 部屋名 (= `#room=` / Lobby の部屋名欄) の正規化と生成。
//
// 部屋名はそのまま PeerJS のビーコン ID `la-{roomName}` になる。 PeerJS は ID を
// `/^[A-Za-z0-9]+(?:[ _-][A-Za-z0-9]+)*$/` で検査し、 合わなければ `invalid-id` で
// 接続そのものを打ち切る。 ここで「英数字の塊を `-` / `_` 1 個でつないだ形」 に
// そろえておけば `la-` を前置しても必ず通る (空白は URL で %20 になるので使わない)。

export const DEFAULT_ROOM_NAME = "default";
export const ROOM_NAME_MAX_LENGTH = 32;

/**
 * 入力欄の 1 打鍵ごとに使う緩いフィルタ。 空白は `-` に置き換え、 英数字と `-` `_`
 * 以外は捨てる。 末尾の `-` は打鍵途中 (`my-` → `my-room`) で必要なので残す。
 */
export const filterRoomNameInput = (raw: string): string =>
  raw
    .replace(/\s+/g, "-")
    .replace(/[^A-Za-z0-9_-]/g, "")
    .slice(0, ROOM_NAME_MAX_LENGTH);

/**
 * 実際に接続に使う部屋名。 連続する区切りは最初の 1 個に縮め、 先頭と末尾の区切りは
 * 落とす。 何も残らなければ "" (= 呼び出し側で公開部屋 `default` に読み替える)。
 */
export const normalizeRoomName = (raw: string): string =>
  filterRoomNameInput(raw)
    .replace(/([_-])[_-]+/g, "$1")
    .replace(/^[_-]+|[_-]+$/g, "");

/** URL hash の値は %エンコードされていることがあるので、 戻せるなら戻してから正規化。 */
export const roomNameFromHashValue = (value: string | undefined): string => {
  if (!value) return "";
  let decoded = value;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    // 壊れた %エンコードはそのまま正規化に回す
  }
  return normalizeRoomName(decoded);
};

// 読み上げて伝えても間違えにくいよう、 0/o・1/l/i を除いた小文字と数字。
const ROOM_NAME_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
const GENERATED_ROOM_NAME_LENGTH = 6;

/** 「新しい部屋」 ボタン用のランダムな部屋名 (31^6 ≈ 9 億通り)。 */
export const generateRoomName = (
  randomValues: (buf: Uint32Array) => Uint32Array = (buf) =>
    crypto.getRandomValues(buf),
): string => {
  const buf = randomValues(new Uint32Array(GENERATED_ROOM_NAME_LENGTH));
  let name = "";
  for (const v of buf)
    name += ROOM_NAME_ALPHABET[v % ROOM_NAME_ALPHABET.length];
  return name;
};

/** 友だちに送る招待リンク。 自分の操作系などの hash 設定は混ぜず、 部屋名だけ載せる。 */
export const roomShareUrl = (
  room: string,
  loc: Pick<Location, "origin" | "pathname"> = window.location,
): string => `${loc.origin}${loc.pathname}#room=${room}`;
