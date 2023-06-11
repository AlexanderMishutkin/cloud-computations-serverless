export interface UniversalFile {
  user_sub: string;
  file_id: string;
  name: string;
  type: string;
  size: number;
  creation_date: string;
  last_update: string;
  shared_with_emails: string[];
  album_id: string;
  data: string | undefined;
  s3_url: string | undefined;
}

export interface Album {
  user_sub: string;
  album_id: string;
  name: string;
  creation_date: string;
  last_update: string;
  shared_with_emails: string[];
  files_ids: string[]
}

export interface FamilyInvite {
  invited_email: string;
  inviter_email: string;
  invited_name: string;
  invite_status: string;
}
