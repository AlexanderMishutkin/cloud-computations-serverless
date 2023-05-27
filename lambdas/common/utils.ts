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