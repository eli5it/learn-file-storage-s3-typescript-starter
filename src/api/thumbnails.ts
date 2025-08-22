import { getBearerToken, validateJWT } from "../auth";
import { respondWithJSON } from "./json";
import { getVideo, updateVideo } from "../db/videos";
import type { ApiConfig } from "../config";
import type { BunRequest } from "bun";
import { write } from "bun";
import path from "path";
import { BadRequestError, NotFoundError, UserForbiddenError } from "./errors";
import { randomBytes } from "crypto";

type Thumbnail = {
  data: ArrayBuffer;
  mediaType: string;
};

export async function handlerUploadThumbnail(cfg: ApiConfig, req: BunRequest) {
  const { videoId } = req.params as { videoId?: string };
  if (!videoId) {
    throw new BadRequestError("Invalid video ID");
  }

  const token = getBearerToken(req.headers);
  const userID = validateJWT(token, cfg.jwtSecret);

  const formData = await req.formData();
  const file = formData.get("thumbnail");
  if (
    !(file instanceof File) ||
    (file.type !== "image/png" && file.type !== "image/jpeg")
  ) {
    throw new BadRequestError("Invalid data provided");
  }

  const mediaType = file.type;
  const fileExtension = mediaType.split("/")[1];
  const MAX_UPLOAD_SIZE = 10 << 20;

  const fileName = randomBytes(32).toString("base64url");
  const dataURL = path.join(cfg.assetsRoot, fileName, fileExtension);

  const videoData = await getVideo(cfg.db, videoId);

  if (!videoData) {
    throw new NotFoundError(`could not find video with id: ${videoId}`);
  }

  if (file.size > MAX_UPLOAD_SIZE) {
    throw new BadRequestError("File too large");
  }
  if (!(videoData?.userID === userID)) {
    throw new UserForbiddenError("Not your video");
  }

  await write(dataURL, file);
  const updatedVideo = { ...videoData, thumbnailURL: dataURL };

  await updateVideo(cfg.db, updatedVideo);

  return respondWithJSON(200, updatedVideo);
}
