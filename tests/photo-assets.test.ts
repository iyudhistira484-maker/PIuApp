import test from "node:test";
import assert from "node:assert/strict";
import {
  PHOTO_MIMES,
  PROJECT_PHOTOS_BYTES_MAX,
  PROJECT_PHOTOS_MAX,
  fitPhotos,
  isPhotoMime,
  isStoredPhoto,
  photoBytes,
  photoFromAttachment,
  photoId,
  photoKey,
  photoSize,
} from "../src/lib/photo-assets.ts";
import { samplePalette } from "../src/lib/photo-palette.ts";

// Photos kept with a project. What has to stay true: the stored bytes are the
// attached bytes (so the colours someone sees come from their own photo), the
// caps are real (a browser store the user cannot see must not grow forever),
// and nothing is invented for a file that cannot be a photo.

const base64 = (text: string) => Buffer.from(text).toString("base64");
const png = (extra = "") => ({
  name: "kursi.png",
  mime: "image/png",
  data: base64("fake-png-bytes" + extra),
});

test("only the images an attachment accepts can become a project photo", () => {
  assert.equal(isPhotoMime("image/png"), true);
  assert.equal(isPhotoMime("image/webp"), true);
  assert.equal(isPhotoMime("application/pdf"), false);
  assert.equal(isPhotoMime("text/plain"), false);
  assert.deepEqual([...PHOTO_MIMES], ["image/png", "image/jpeg", "image/webp"]);
  assert.throws(
    () => photoFromAttachment({ ...png(), mime: "application/pdf" }),
    /Hanya PNG, JPG, atau WebP/,
  );
  assert.throws(
    () => photoFromAttachment({ ...png(), data: "" }),
    /Isi foto kosong/,
  );
  assert.throws(() => photoFromAttachment(null as any), /tidak dapat disimpan/);
});

test("a stored photo keeps the attached bytes and their sampled colours", () => {
  const palette = samplePalette(
    new Uint8ClampedArray([200, 32, 32, 255, 32, 64, 192, 255]),
    2,
    1,
    2,
    1,
  );
  const photo = photoFromAttachment(
    { ...png(), name: "kursi-depan.png" },
    {
      at: 1000,
      from: "msg-1",
      palette,
      thumbnail: "data:image/jpeg;base64,xx",
    },
  );
  assert.equal(photo.name, "kursi-depan.png");
  assert.equal(photo.mime, "image/png");
  assert.equal(photo.data, png().data);
  assert.equal(photo.bytes, photoBytes(png().data));
  assert.equal(photo.at, 1000);
  assert.equal(photo.from, "msg-1");
  assert.deepEqual(photo.palette, palette);
  assert.equal(photo.thumbnail, "data:image/jpeg;base64,xx");
  // The id is the content, not the name: the same picture is one photo.
  assert.equal(photo.id, photoId("image/png", png().data));
  assert.equal(
    photoFromAttachment({ ...png(), name: "salinan.png" }).id,
    photo.id,
  );
  assert.notEqual(photoFromAttachment(png("lain")).id, photo.id);
});

test("the byte count is read without decoding the base64 payload", () => {
  // Three bytes become four base64 characters; padding is not image data.
  assert.equal(photoBytes(Buffer.from("abc").toString("base64")), 3);
  assert.equal(photoBytes(Buffer.from("ab").toString("base64")), 2);
  assert.equal(photoBytes(Buffer.from("abcd").toString("base64")), 4);
  const fourMb = "A".repeat(Math.ceil((4 * 1024 * 1024 * 4) / 3));
  assert.ok(photoBytes(fourMb) >= 4 * 1024 * 1024 - 4);
  assert.match(photoSize(1200), /KB$/);
  assert.equal(photoSize(512), "512 B");
  assert.equal(photoSize(1536 * 1024), "1,5 MB");
});

test("a photo bigger than the project store allows is refused in plain words", () => {
  const huge = "A".repeat(Math.ceil((PROJECT_PHOTOS_BYTES_MAX * 4) / 3) + 64);
  assert.throws(
    () =>
      photoFromAttachment({ name: "besar.png", mime: "image/png", data: huge }),
    /batas per foto di aset project/,
  );
});

test("the caps are real, and the oldest photo is the one that goes", () => {
  const photo = (id: string, at: number, bytes = 1024) => ({
    id,
    name: `${id}.png`,
    mime: "image/png",
    bytes,
    at,
  });
  const kept = fitPhotos([photo("a", 1), photo("b", 2)], [photo("c", 3)], {
    countMax: 2,
  });
  assert.deepEqual(
    kept.keep.map((p) => p.id),
    ["c", "b"],
  );
  assert.deepEqual(
    kept.dropped.map((p) => p.id),
    ["a"],
  );
  // The byte budget bites before the count does, because it is the one a person
  // cannot see: three 8 MB photos do not fit in a 16 MB project store.
  const byBytes = fitPhotos(
    [],
    [
      photo("x", 3, 8 * 1024 * 1024),
      photo("y", 2, 8 * 1024 * 1024),
      photo("z", 1, 8 * 1024 * 1024),
    ],
  );
  assert.deepEqual(
    byBytes.keep.map((p) => p.id),
    ["x", "y"],
  );
  assert.deepEqual(
    byBytes.dropped.map((p) => p.id),
    ["z"],
  );
  // Re-saving a photo that is already there updates it instead of duplicating.
  const again = fitPhotos([photo("a", 1)], [photo("a", 9)]);
  assert.equal(again.keep.length, 1);
  assert.equal(again.keep[0].at, 9);
  // Caps can be lowered by the caller, and the defaults are the documented ones.
  assert.equal(fitPhotos([], [], { countMax: 1 }).keep.length, 0);
  assert.equal(PROJECT_PHOTOS_MAX, 12);
  assert.equal(PROJECT_PHOTOS_BYTES_MAX, 16 * 1024 * 1024);
});

test("records read back from the browser store are checked before use", () => {
  const good = {
    key: photoKey("account:1", "project-1", "abc"),
    id: "abc",
    name: "kursi.png",
    mime: "image/png",
    bytes: 1024,
    at: 10,
    data: base64("bytes"),
  };
  assert.equal(isStoredPhoto(good), true);
  assert.equal(isStoredPhoto({ ...good, data: "" }), false);
  assert.equal(isStoredPhoto({ ...good, mime: "application/pdf" }), false);
  assert.equal(isStoredPhoto({ ...good, bytes: "banyak" }), false);
  assert.equal(isStoredPhoto(null), false);
  // Keys are scoped by account and project, so two accounts sharing one browser
  // never see each other's photos.
  assert.equal(photoKey("account:1", "p", "x"), "account:1:p:x");
  assert.notEqual(
    photoKey("account:2", "p", "x"),
    photoKey("account:1", "p", "x"),
  );
});
