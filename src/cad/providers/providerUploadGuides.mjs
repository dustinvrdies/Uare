export const providerUploadGuides = {
  s3: {
    package: '@aws-sdk/client-s3',
    env: ['AWS_REGION', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'S3_BUCKET'],
    implementation_note: 'Replace uploadPlaceholder with PutObjectCommand and return object URL.',
  },
  r2: {
    package: '@aws-sdk/client-s3',
    env: ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET'],
    implementation_note: 'Use S3-compatible client with R2 endpoint and return public/custom-domain URL.',
  },
  gcs: {
    package: '@google-cloud/storage',
    env: ['GCS_PROJECT_ID', 'GCS_BUCKET', 'GOOGLE_APPLICATION_CREDENTIALS'],
    implementation_note: 'Replace uploadPlaceholder with bucket.upload and signed URL generation.',
  },
};
