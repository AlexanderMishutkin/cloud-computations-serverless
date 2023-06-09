import DynamoDB from "aws-sdk/clients/dynamodb";
import { Album, UniversalFile } from "./entities";
import { error } from "console";

export function generateSafeS3Name(originalName: string) {
  originalName = originalName.split('.')[0];
  // Remove special characters and replace spaces with hyphens
  const sanitized = originalName
    .replace(/[^a-zA-Z0-9]/g, '')
    .replace(/\s/g, '_');

  // Trim to a maximum of 63 characters
  const trimmed = sanitized.slice(0, 30);
  return trimmed.toLowerCase();
}

export async function getDefaultAlbum(userSub: string, dynamoDB: DynamoDB.DocumentClient): Promise<Album> {
  let responce = await dynamoDB.get({
    TableName: "Albums",
    Key: {
      album_id: userSub
    }
  }).promise();
  let album = responce.Item as Album;
  if (album) return album;

  album = {
    user_sub: userSub,
    album_id: userSub,
    name: 'Default',
    creation_date: new Date().toLocaleDateString(),
    last_update: new Date().toLocaleDateString(),
    shared_with_emails: [],
    files_ids: []
  }
  await dynamoDB.put({
    TableName: "Albums",
    Item: {
      ...album
    }
  }).promise();
  return album;
}

export async function getAlbum(albumId: string, email: string, userSub: string, dynamoDB: DynamoDB.DocumentClient): Promise<{ album: Album | undefined, error: any }> {
  if (!albumId || albumId == userSub) return { album: await getDefaultAlbum(userSub, dynamoDB), error: undefined };
  let responce = await dynamoDB.get({
    TableName: "Albums",
    Key: {
      album_id: albumId
    }
  }).promise();
  let album = responce.Item as Album;
  if (!album) return { album: undefined, error: { statusCode: 404, body: "No such album!" } };

  // Security
  if (album.user_sub != userSub && !album.shared_with_emails.find(e => e == email)) return { album: undefined, error: { statusCode: 403, body: "Albom does not exist or you have no access to it!" } };

  return { album: album, error: undefined };
}

export async function changeAlbum(newAlbum: Album, userSub: string, dynamoDB: DynamoDB.DocumentClient): Promise<{ album: Album | undefined, error: any }> {
  let responce = await dynamoDB.get({
    TableName: "Albums",
    Key: {
      album_id: newAlbum.album_id
    }
  }).promise();
  let album = responce.Item as Album;
  if (!album) return { album: undefined, error: { statusCode: 404, body: "No such album!" } };

  // Security
  if (album.user_sub != userSub) return { album: undefined, error: { statusCode: 403, body: "Album must be your's!" } };
  for (let fileId of (newAlbum.files_ids ?? [])) {
    let responce = await dynamoDB.get({
      TableName: "Files",
      Key: {
        file_id: fileId
      }
    }).promise();
    let file = responce.Item as UniversalFile;
    if (!file) return { album: undefined, error: { statusCode: 401, body: "One of files not found!" } };
    if (file.user_sub != userSub) return { album: undefined, error: { statusCode: 403, body: "Can not add somebodies else file to your album!" } };
  }

  await dynamoDB.delete({
    TableName: 'Albums',
    Key: {
      album_id: album.album_id
    }
  }).promise()

  album = {
    user_sub: userSub,
    album_id: album.album_id,
    name: newAlbum.name,
    creation_date: album.creation_date,
    last_update: new Date().toLocaleDateString(),
    shared_with_emails: newAlbum.shared_with_emails ?? album.shared_with_emails,
    files_ids: newAlbum.files_ids ?? album.files_ids
  }
  await dynamoDB.put({
    TableName: "Albums",
    Item: {
      ...album
    }
  }).promise();
  return { album: album, error: undefined };
}
