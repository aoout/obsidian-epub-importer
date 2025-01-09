/* eslint-disable @typescript-eslint/no-explicit-any */

export const findProperty = (obj: any, propertyNames: string | string[]): any => {
    const names = Array.isArray(propertyNames) ? propertyNames : [propertyNames];
    
    for (const name of names) {
        if (obj[name]) return obj[name];
        
        for (const key in obj) {
            const parts = key.split(':');
            if (parts.length === 2 && parts[1] === name && obj[key]) {
                return obj[key];
            }
        }
    }
    
    if (Array.isArray(obj)) {
        for (const item of obj) {
            if (typeof item === "object" && item !== null) {
                const result = findProperty(item, propertyNames);
                if (result) return result;
            }
        }
    }
    
    for (const key in obj) {
        if (typeof obj[key] === "object" && obj[key] !== null) {
            const result = findProperty(obj[key], propertyNames);
            if (result) return result;
        }
    }
    return null;
};