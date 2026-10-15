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

/** A recorded call to a fake. */
export type Calls = unknown[][];

/**
 * Groups stubs so a test file can restore them all in afterEach:
 *
 *   const sandbox = createSandbox();
 *   afterEach(() => sandbox.restore());
 *   const calls = sandbox.stub(User, 'findOne', async () => null);
 */
export const createSandbox = () => {
    const restorers: Array<() => void> = [];
    return {
        /** Replace target[key] with impl; returns the list of argument arrays it was called with. */
        stub<T extends object>(target: T, key: keyof T & string, impl: (...args: never[]) => unknown): Calls {
            const calls: Calls = [];
            restorers.push(stubMethod(target, key, (...args: never[]) => {
                calls.push(args);
                return impl(...args);
            }));
            return calls;
        },
        restore(): void {
            while (restorers.length) restorers.pop()?.();
        },
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
