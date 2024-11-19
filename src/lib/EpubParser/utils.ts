/* eslint-disable @typescript-eslint/no-explicit-any */

export const findProperty = (obj: any, propertyName: string): any => {
    if (obj[propertyName]) return obj[propertyName];
    for (const key in obj) {
        if (typeof obj[key] === 'object' && obj[key] !== null) {
            const result = findProperty(obj[key], propertyName);
            if (result) return result;
        }
    }
    return null;
}; 