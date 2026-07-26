import { materializeWebAppIcons } from './prepare-pages-site.mjs';

materializeWebAppIcons()
  .then((outputDir) => {
    console.log(`Prepared local icon assets: ${outputDir}`);
  })
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
