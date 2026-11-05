/** `import url from 'file?url'`: Vite hands back the file's URL in the build (pdf.js's worker is loaded this way). */
declare module '*?url' {
  const url: string
  export default url
}
