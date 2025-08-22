import { respondWithJSON } from "./json";

import { type ApiConfig } from "../config";
import type { BunRequest, S3File } from "bun";
import { BadRequestError, UserForbiddenError } from "./errors";
import { validateJWT } from "../auth";
import { getBearerToken } from "../auth";
import { getUser } from "../db/users";
import { getVideo, updateVideo } from "../db/videos";
import { s3, write } from "bun";
import path from "path";
import { randomBytes } from "crypto";

export async function handlerUploadVideo(cfg: ApiConfig, req: BunRequest) {
  const SIZE_LIMIT = 1 << 30;
  const { videoId } = req.params as { videoId?: string };
  const video = videoId ? await getVideo(cfg.db, videoId) : undefined;

  if (!video) {
    throw new BadRequestError("Invalid video ID");
  }
  const token = getBearerToken(req.headers);
  const userID = validateJWT(token, cfg.jwtSecret);

  if (!(video.userID === userID)) {
    throw new UserForbiddenError("invalid user");
  }

  const formData = await req.formData();
  const fileName = randomBytes(32).toString("base64url");

  const file = formData.get("video");

  if (
    !(file instanceof File) ||
    file.type !== "video/mp4" ||
    file.size > SIZE_LIMIT
  ) {
    throw new BadRequestError("please provided a valid video");
  }

  const mediaType = file.type;
  const fileExtension = mediaType.split("/")[1];
  const s3Key = `videos/${fileName}.${fileExtension}`;

  // Upload file to S3
  const s3file: S3File = s3.file(s3Key);
  await s3file.write(file, {
    bucket: cfg.s3Bucket,
    region: cfg.s3Region,
  });

  // Generate the S3 URL
  const s3Url = `https://s3.${cfg.s3Region}.amazonaws.com/${cfg.s3Bucket}/${s3Key}`;

  const updatedVideo = { ...video, videoURL: s3Url };
  await updateVideo(cfg.db, updatedVideo);
  return respondWithJSON(200, updatedVideo);
}
