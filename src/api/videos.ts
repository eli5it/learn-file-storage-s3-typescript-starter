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
import type { Video } from "../db/videos";

async function getVideoAspectRatio(filepath: string) {
  const command = `ffprobe -v error -print_format json -show_streams ${filepath}`
  const proc = Bun.spawn(command.split(' '));
  const exitCode = await proc.exited
  if (exitCode !== 0) {
    throw new Error("Invalid Response")
  }
//@ts-ignore
const stdout = await proc.stdout.text()
const json = JSON.parse(stdout)
const stream1 = json.streams[0]
const [width, height] = [stream1.width, stream1.height]
const aspectRatio = width / height
let aspectRatioString: string | undefined
if ((16 / 9) - 0.01 <= aspectRatio && aspectRatio <= (16 / 9) + 0.01) {
  aspectRatioString = "portrait"
} else if ((9 / 16  ) - 0.01 <= aspectRatio && aspectRatio <= (9 / 16) + 0.01) {
  aspectRatioString = "landscape"
}

return aspectRatioString ?? "other"

}


export async function processVideoForFastStart(inputFilePath: string) {
  const outputFilePath = `${inputFilePath

  }.processed`
  const command = ["ffmpeg", '-y', "-i", inputFilePath, "-movflags", "faststart", "-map_metadata", "0", "-codec", "copy", "-f", "mp4", outputFilePath]
  const proc = Bun.spawn(command)
  const exitCode = await proc.exited
   if (exitCode !== 0) {
    console.log('error processing for fast start')
    throw new Error("Invalid Response")
  }
  return outputFilePath
}


export  function generatePresignedURL(cfg: ApiConfig, key: string, expireTime: number) {
  const url  = s3.presign(key, {
    expiresIn: expireTime
  })
  return url
}

export function dbVideoToSignedVideo(cfg: ApiConfig, video: Video) {
  if (video.videoURL) {
    return {...video,  videoURL: generatePresignedURL(cfg, video.videoURL!, 3600)}
  } return video
}


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
  await Bun.write(`/tmp/video${fileExtension}`, file)
  const aspectRatio = await getVideoAspectRatio('/tmp/video')
  const outputFilePath = await processVideoForFastStart("/tmp/video")
  const processedFileData = await Bun.file(outputFilePath).arrayBuffer();
  
  const s3Key = `videos/${aspectRatio}/${fileName}.${fileExtension}`;
  

  // Upload file to S3
  const s3file: S3File = s3.file(s3Key);
  await s3file.write(processedFileData, {
    bucket: cfg.s3Bucket,
    region: cfg.s3Region,
  });



  const updatedVideo = { ...video, videoURL: s3Key };
  await updateVideo(cfg.db, updatedVideo);
  const signedVideo = dbVideoToSignedVideo(cfg, updatedVideo)
  console.log(signedVideo)
  return respondWithJSON(200, signedVideo);
}
