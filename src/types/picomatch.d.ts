declare module "picomatch" {
  interface PicomatchOptions {
    dot?: boolean;
    nocase?: boolean;
  }
  function picomatch(
    glob: string | readonly string[],
    options?: PicomatchOptions,
  ): (input: string) => boolean;
  export default picomatch;
}
