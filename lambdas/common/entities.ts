export interface UniversalFile {
  user_sub: string;
  file_id: string;
  name: string;
  type: string;
  size: number;
  creationDate: string;
  lastUpdate: string;
  sharedWithEmails: string[];
  album_id: string;
  data: string | undefined;
  s3_url: string | undefined;
}

export interface Album {
  user_sub: string;
  album_id: string;
  name: string;
  creationDate: string;
  lastUpdate: string;
  sharedWithEmails: string[];
  files_ids: {file_id: string}[]
}

export interface FamilyInvite {
  invited_email: string;
  inviter_email: string;
  declined: boolean;
  accepted: boolean;
}
