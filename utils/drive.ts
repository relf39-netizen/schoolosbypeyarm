/**
 * Converts a Google Drive "view" URL to a direct image link that can be used in <img> tags.
 * Example: https://drive.google.com/file/d/FILE_ID/view?usp=sharing
 * To: https://drive.google.com/uc?export=view&id=FILE_ID
 */
export const getDirectDriveUrl = (url: string | undefined | null): string => {
  if (!url) return '';
  
  // If it's already a direct link or base64, return as is
  if (url.includes('drive.google.com/uc') || url.startsWith('data:')) {
    return url;
  }

  // Handle standard view links
  if (url.includes('drive.google.com') && url.includes('/file/d/')) {
    const parts = url.split('/file/d/');
    if (parts.length > 1) {
      const fileId = parts[1].split('/')[0].split('?')[0];
      return `https://drive.google.com/uc?export=view&id=${fileId}`;
    }
  }
  
  // Handle open?id= links
  if (url.includes('drive.google.com/open?id=')) {
    const fileId = url.split('open?id=')[1].split('&')[0];
    return `https://drive.google.com/uc?export=view&id=${fileId}`;
  }

  return url;
};
