import path from 'path';

export function getLocalDataDir() {
  return process.env.HELLO_PICNIC_DATA_DIR || path.join(process.cwd(), '.local');
}
