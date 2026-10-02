// The hooks runtime has the base64 methods of Uint8Array; lib es2023 does not type them yet.
interface Uint8Array<TArrayBuffer extends ArrayBufferLike = ArrayBufferLike> {
  toBase64(): string
}

interface Uint8ArrayConstructor {
  fromBase64(text: string): Uint8Array<ArrayBuffer>
}
