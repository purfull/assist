/**
 * Plain-object stand-ins for Sequelize model instances in unit tests. They carry the
 * fields a controller reads plus the instance methods it calls, and record those calls.
 */
export interface FakeInstance {
    saved: number;
    destroyed: number;
    updates: Array<Record<string, unknown>>;
    save(): Promise<FakeInstance>;
    destroy(): Promise<void>;
    update(values: Record<string, unknown>): Promise<FakeInstance>;
    reload(): Promise<FakeInstance>;
    changed(): void;
}

export const fakeInstance = <T extends object>(fields: T): T & FakeInstance => {
    const instance: T & FakeInstance = Object.assign(Object.create(null) as object, fields, {
        saved: 0,
        destroyed: 0,
        updates: [] as Array<Record<string, unknown>>,
        async save() { instance.saved++; return instance; },
        async destroy() { instance.destroyed++; },
        async update(values: Record<string, unknown>) {
            Object.assign(instance, values);
            instance.updates.push(values);
            return instance;
        },
        async reload() { return instance; },
        changed() { /* JSON column bookkeeping; nothing to do */ },
        // Express serialises responses with JSON.stringify
        toJSON() {
            const { saved: _s, destroyed: _d, updates: _u, ...rest } = instance;
            return Object.fromEntries(Object.entries(rest).filter(([, v]) => typeof v !== 'function'));
        },
    });
    return instance;
};

/** A verified user as the identity controllers expect it. */
export const fakeUser = (overrides: Record<string, unknown> = {}) => fakeInstance({
    id: 42,
    email: 'user@example.com',
    name: 'Test User',
    password: null as string | null,
    googleId: null as string | null,
    isVerified: true,
    phone: null,
    companyName: null,
    billingAddress: null,
    city: null,
    state: null,
    zipCode: null,
    country: null,
    taxId: null,
    credits: 0,
    trialEndsAt: null as Date | null,
    trialWarningDays: 7,
    ...overrides,
});
