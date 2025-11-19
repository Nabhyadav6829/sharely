# sharely

A file-sharing web application designed to make sharing files simple, secure and user-friendly.

## Features

- Upload files of various types and share a download link.  
- Optionally set an expiration time or download limit for the link.  
- View a list of your uploaded files with status, expiry and download count.  
- Responsive UI that works on desktop and mobile.  
- Secure handling of uploads (e.g. virus/mime-type checks, size limits).  
- Optionally user-authentication for managing files and viewing history.  

## Tech Stack

- **Backend**: Node.js + Express.js  
- **Storage**: Local file system / Cloud storage (S3, Google Cloud Storage)  
- **Database**: MongoDB / PostgreSQL (depending on your choice)  
- **Frontend**: HTML, CSS, JavaScript (or optionally React/Vue)  
- **Environment Variables**:  
  ```env
  PORT=3000
  UPLOAD_DIR=/path/to/uploads
  DB_URI=mongodb://localhost/sharely
  MAX_FILE_SIZE=50MB
