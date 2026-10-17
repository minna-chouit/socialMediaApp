/** Short-lived signed URLs for the media bank, via Supabase Storage. The service key stays server-side. */
export function supabaseSigner(supabaseUrl: string, serviceKey: string, bucket = 'media') {
  return async (storagePath: string): Promise<string | null> => {
    const response = await fetch(`${supabaseUrl}/storage/v1/object/sign/${bucket}/${storagePath}`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${serviceKey}`,
        apikey: serviceKey,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ expiresIn: 600 }),
    });
    if (!response.ok) return null; // e.g. the bucket is not set up yet; list_media still works
    const { signedURL } = (await response.json()) as { signedURL: string };
    return `${supabaseUrl}/storage/v1${signedURL}`;
  };
}
