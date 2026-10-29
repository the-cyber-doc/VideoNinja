// The API's types, by the names the app uses: all generated from the backend's own
// schema (schema.d.ts, from server/openapi.json: tools/api-types.sh), none written
// here by hand. A change on the server shows up as a type error where it matters.
import type { components, paths } from './schema';

type Schemas = components['schemas'];

/** The JSON answer of an operation (its 200 or 201), for those without a named model. */
export type Answer<P extends keyof paths, M extends keyof paths[P]> = paths[P][M] extends {
	responses: infer R;
}
	? R extends { 200: { content: { 'application/json': infer T } } }
		? T
		: R extends { 201: { content: { 'application/json': infer T } } }
			? T
			: never
	: never;

export type ApiErrorBody = Schemas['ApiError'];

// Accounts
export type User = Schemas['UserOut'];
export type UserRow = Schemas['UserRow'];
export type Role = Schemas['RoleOut'];
export type Invite = Schemas['InviteOut'];
export type NewUser = Schemas['CreateIn'];
export type Credentials = Schemas['LoginIn'];
export type PasswordChange = Schemas['PasswordIn'];
export type TotpConfirm = Schemas['TotpConfirmIn'];
export type SetupComplete = Schemas['SetupCompleteIn'];
export type RegisterComplete = Schemas['RegisterCompleteIn'];
/** A new TOTP secret, its otpauth: URI and QR code (nothing stored yet). */
export type TotpEnrollment = Answer<'/api/profile/totp', 'post'>;
export type About = Schemas['AboutOut'];

// Comments
export type Comment = Schemas['CommentOut'];
export type CommentIn = Schemas['CommentIn'];

// Uploads and annotations
export type Performer = Schemas['Performer'];
/** A tag kind and, if it has some, its fixed values (names in the request's language). */
export type Tag = Schemas['Tag'];
/** A tag set on a video or segment: a fixed value's ID, or the text as typed. */
export type TagIn = Schemas['TagIn'];
export type SegmentIn = Schemas['SegmentIn'];
export type Submit = Schemas['SubmitIn'];
export type UploadStatus = Schemas['UploadStatus'];
export type UploadLimits = Schemas['UploadLimits'];

// Video management
export type VideoRow = Schemas['VideoOut'];
/** A segment as the server keeps it: with its ID once saved. */
export type SavedSegment = Schemas['AnnotatedSegment'];
export type Annotations = Schemas['Annotations'];
export type AnnotationsOut = Schemas['AnnotationsOut'];
