/**
 * Replace a method on a module-level object (e.g. a Sequelize model's static finder) for
 * the duration of a test. Returns a function that restores the original.
 */
export const stubMethod = <T extends object>(target: T, key: keyof T & string, impl: unknown): (() => void) => {
    const holder = target as unknown as Record<string, unknown>;
    const original = holder[key];
    holder[key] = impl;
    return () => {
        holder[key] = original;
    };
};

/**
 * Put a fake module into the require cache so code that imports `modulePath` gets
 * `exports` instead. Must run before anything imports that module.
 */
export const replaceModule = (modulePath: string, exports: unknown): void => {
    const file = require.resolve(modulePath);
    require.cache[file] = { id: file, filename: file, loaded: true, exports } as NodeJS.Module;
};
