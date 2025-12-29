/**
 * Mutex
 * @returns {function} The function awaiting to be executed
 */
class Mutex {
  constructor() {
    this._queue = [];                       // Queue of resolve functions for Promises awaiting locking
    this._locked = false;                   // Boolean indicating whether the mutex is currently locked or not
  }

  acquire() {
    return new Promise(resolve => {         // Returns a Promise that resolves when the lock is acquired
      this._queue.push(resolve);            // Adds the resolve function to the queue array
      this._dispatch();                     // Try to switch to the next lockdown if there isn't one already active
    });
  }

  async runExclusive(fn) {
    const release = await this.acquire();   // Wait for the mutex to be acquired, then receive a release function
    try {
      return await fn();                    // Executes the function passed to fn exclusively (mutex locked)
    } finally {
      release();                            // Release the mutex, allowing the next waiting user to acquire the lock
    }
  }

  _dispatch() {
    if (this._locked) return;               // If already locked, do nothing (wait until the lock is released)
    const next = this._queue.shift();       // Retrieves the next resolve function from the queue
    if (!next) return;                      // If the queue is empty, return (no pending acquisition request)
    this._locked = true;                    // Mark the mutex as locked
    next(() => {                            // Call the resolve function to signal that the Promise has been acquired
      this._locked = false;                 // Passes a release function that will be called to release the lock
      this._dispatch();                     // Restart the search for a next person waiting to pass the lock on to them
    });
  }
}

const mutexStorage = new Mutex();



/**
 * Store the tabs hierarchy of each windows in the extension local storage
 * @param {Map<number, Map<number, number||null>>} _tabstruct - Map of tabs hierarchy for the every windows
 */
async function tabstructSet(_tabstruct) {
    const serializable = Array.from(_tabstruct.entries()); // [windowId, [tabId, data]]
    for (let i = 0; i < serializable.length; i++) {
        const [, windowMap] = serializable[i];
        serializable[i][1] = Array.from(windowMap.entries());
    }
    await chrome.storage.local.set({ tabstruct: serializable });
}

/**
 * Retrieve the stored tabs hierarchy of each windows from the extension local storage
 * @param {bool} _keepSerialized - Description
 * @returns {Map<number, Map<number, number||null>>} The tabs hierarchy
 */
async function tabstructGet(_keepSerialized = false) {
    const result = await chrome.storage.local.get('tabstruct');
    if (_keepSerialized)
        return result.tabstruct;
    if (!result.tabstruct || !Array.isArray(result.tabstruct)) {
        return new Map();
    }
    
    const tabstruct = new Map();
    for (const [windowId, windowData] of result.tabstruct) {
        if (Array.isArray(windowData)) {
            tabstruct.set(windowId, new Map(windowData));
        } else {
            tabstruct.set(windowId, new Map(Object.entries(windowData || {})));
        }
    }
    return tabstruct;
}

/**
 * Create a dummy element in the storage about the tabs hierarchy
 */
async function initLocalStorage() {
    await mutexStorage.runExclusive(async () => {
        // Get all windows
        const windows = await chrome.windows.getAll({ windowTypes: [ 'normal' ], populate: true });
        
        const tabstruct = new Map();
        
        // For each window
        for (const wnd of windows) {
            // Store each tab's ID
            tabstruct.set(wnd.id, new Map());

            for (const tab of wnd.tabs) {
                tabstruct.get(wnd.id)?.set(tab.id, null);
            }
        }

        await tabstructSet(tabstruct);
    });
}

/**
 * Retrieve the tab properties
 * @param {number} tabId - Tab ID
 * @returns {type} Description
 */
function queryTabInfo(tabId) {
    return new Promise((resolve) => {
        chrome.tabs.get(tabId, resolve);
    });
}

/**
 * Update the tabs properties
 * @param {object} queryInfo - Properties of the tab to modify
 * @returns {Promise<Tab[]>} Properties of the tab at the current state
 */
function queryTabsAsync(queryInfo) {
    return new Promise((resolve) => {
        chrome.tabs.query(queryInfo, resolve);
    });
}

/**
 * Find the last child of a tab, used when slicing the tabs structure to remove/move a chunk of tabs
 * @param {Map<number, number||null>} _tabStructure - Map of tabs hierarchy for a specific window
 * @param {number} _tabId - ID of the tab
 * @returns {map<bool, number>} Has a child been found; the number of items located under the specified tab that are their children
 */
function findLastChild(_tabStructure, _tabId) {
    let i = 0;
    for (const [key, value] of _tabStructure) {
        if (value === _tabId) {
            return { found: true, index: i };
        }
        i++;
    }

    return { found: false, index: 0 };
}

/**
 * If the tab is pinned (chrome.tabs.onUpdate under Chrome, chrome.tabs.onCreated under Vivaldi),
 * place its ID at the end of the pinned tabs chunk of the storage.
 * @param {number} _tabId - ID of the tab
 * @param {bool} _pinned - Does the tab is pinned
 * @param {number} _windowId - ID of the window
 */
async function processPinned(_tabId, _pinned, _windowId, _isCreated) {
    let tabstruct = await tabstructGet();
    if (tabstruct.has(_windowId)) {
        let tmp = tabstruct.get(_windowId);
        let pinnedParentID = null;

        if (!_isCreated) {
            pinnedParentID = tmp.get(_tabId) ?? null;

            // Remove the tab temporarily
            tmp.delete(_tabId);

            // The children of the pinned tab become children of the pinned tab’s parent
            for (const [key, value] of tmp) {
                if (value === _tabId) {
                    tmp.set(key, pinnedParentID);
                }
            }
        }

        // Put the pinned tab to the end of the pinned tabs chunk
        if (_pinned) {
            // Find the last pinned tab in the structure
            let lastPinnedID = null;
            const tabs = await queryTabsAsync({ windowId: _windowId });
            for (const tab of tmp.keys()) {
                const tabInfos = tabs.find(t => t.id === tab);
                const tabIsPinned = tabInfos.pinned;
                if (tabIsPinned) {
                    if (tab !== _tabId)
                        lastPinnedID = tab;
                } else {
                    break;
                }
            }
            const keysArray = Array.from(tmp.keys());
            let indexCut = null;
            if (lastPinnedID !== null && keysArray.includes(lastPinnedID))
                indexCut = keysArray.indexOf(lastPinnedID) + 1;
            else
                indexCut = 0;


            // Slice and merge the window's structure to put the pinned tab at the end of the pinned tabs list
            const tmpEndPinned = indexCut > 0 ? new Map(Array.from(tmp.entries()).slice(0, indexCut)) : new Map();
            const tmpBegNormal = indexCut < tmp.size ? new Map(Array.from(tmp.entries()).slice(indexCut)) : new Map();
            const tmpTog = new Map([
                ...Array.from(tmpEndPinned.entries()),
                [_tabId, null],
                ...Array.from(tmpBegNormal.entries())
            ]);

            // Update the window's structure
            tmp = tmpTog;
        } else {
            // Push the unpinned tab to the end of the list of the normal tabs
            tmp.set(_tabId, null);
        }

        tabstruct.set(_windowId, tmp);
        await tabstructSet(tabstruct);

        if (!_isCreated) {
            chrome.runtime.sendMessage({
                action: 'syncTabsList',
                data: {
                    windowId: _windowId
                }
            }, (response) => {
                if (chrome.runtime.lastError) {
                    return;
                }
            });
        }
    }
}



/**
 * Fired when the extension is first installed, when the extension is updated to a new version,
 * and when Chrome is updated to a new version.
 * Used to initialize the local storage for the future tabs hierarchy structure
 * @param {object} details
 */
chrome.runtime.onInstalled.addListener(async (details) => {
    await initLocalStorage();
    if (details.reason === 'install') {
        if (chrome.runtime.openOptionsPage) {
            chrome.runtime.openOptionsPage();
        } else {
            window.open(chrome.runtime.getURL('options.html'));
        }
    }
});

/**
 * Fired when a profile that has this extension installed first starts up.
 * This event is not fired when an incognito profile is started,
 * even if this extension is operating in 'split' incognito mode.
 */
chrome.runtime.onStartup.addListener(async () => {
    await initLocalStorage();
});

/**
 * Fired when a message is sent from either an extension process (by runtime.sendMessage) or a content script (by tabs.sendMessage).
 * @param {any} msg
 * @param {MessageSender} sender
 * @param {function} sendResponse
 */
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    // sidepanel.js asks for the stored tabs structure
    if (msg.type === 'tabstruct') {
        mutexStorage.runExclusive(async () => {
            const tabstruct = await tabstructGet(true);
            sendResponse(tabstruct);
        });
        return true;
    }
    // sidepanel.js inform about a Drag & Drop
    else if (msg.type === 'movetabs') {
        mutexStorage.runExclusive(async () => {
            let tabstruct = await tabstructGet();

            if (tabstruct.has(msg.payload.windowIdOrig)
                && tabstruct.has(msg.payload.windowIdDest)) {
                let tmpPartKept = null;
                let tmpOrig = tabstruct.get(msg.payload.windowIdOrig);
                let tmpDest = tabstruct.get(msg.payload.windowIdDest);

                // Remove chunk
                {
                    const tabParentID = msg.payload.movingAbove ? tmpDest.get(msg.payload.tabIdTarget) : msg.payload.tabIdTarget;

                    tmpDest.set(msg.payload.tabIdMoving, tabParentID); // Update before cutting

                    const tabMovingIndex = Array.from(tmpOrig.keys()).indexOf(msg.payload.tabIdMoving);

                    // The part before the part to remove
                    const tmpRmvChunk1 = tabMovingIndex >= 0 && tabMovingIndex + msg.payload.itemsNumber <= tmpOrig.size ?
                        new Map(Array.from(tmpOrig.entries()).slice(0, tabMovingIndex)) :
                        new Map();
                    // The part to remove
                    tmpPartKept = tabMovingIndex >= 0 && tabMovingIndex + msg.payload.itemsNumber <= tmpOrig.size ?
                        new Map(Array.from(tmpOrig.entries()).slice(tabMovingIndex, tabMovingIndex + msg.payload.itemsNumber)) :
                        new Map();
                    // The part after the part to remove
                    const tmpRmvChunk2 = tabMovingIndex >= 0 && tabMovingIndex + msg.payload.itemsNumber <= tmpOrig.size ?
                        new Map(Array.from(tmpOrig.entries()).slice(tabMovingIndex + msg.payload.itemsNumber)) :
                        new Map();
                    
                    // Remove the kept part
                    const tmpRmvTog = new Map([
                        ...Array.from(tmpRmvChunk1.entries()),
                        ...Array.from(tmpRmvChunk2.entries())
                    ]);

                    tabstruct.set(msg.payload.windowIdOrig, tmpRmvTog);

                    if (msg.payload.windowIdOrig === msg.payload.windowIdDest)
                        tmpDest = tabstruct.get(msg.payload.windowIdDest);
                }

                // Insert chunk
                {
                    const tabParentIndex = Array.from(tmpDest.keys()).indexOf(msg.payload.tabIdTarget) + (msg.payload.movingAbove ? 0 : 1);

                    // The part before the insertion
                    const tmpInsChunk1 = tabParentIndex >= 0 && tabParentIndex <= tmpDest.size ?
                        new Map(Array.from(tmpDest.entries()).slice(0, tabParentIndex)) :
                        new Map();
                    // The part after the insertion
                    const tmpInsChunk2 = tabParentIndex >= 0 && tabParentIndex <= tmpDest.size ?
                        new Map(Array.from(tmpDest.entries()).slice(tabParentIndex)) :
                        new Map();
                    
                    // Insert the kept part
                    const tmpInsTog = new Map([
                        ...Array.from(tmpInsChunk1.entries()),
                        ...Array.from(tmpPartKept.entries()),
                        ...Array.from(tmpInsChunk2.entries())
                    ]);

                    tabstruct.set(msg.payload.windowIdDest, tmpInsTog);
                }

                if (msg.payload.windowIdOrig !== msg.payload.windowIdDest) {
                    // Move tabs
                    const tabMovingInfo = await queryTabInfo(msg.payload.tabIdTarget);
                    const indexTarget = tabMovingInfo.index;
                    const arrTabsIDs = Array.from(tmpPartKept.keys());
                    await chrome.tabs.move(arrTabsIDs, { windowId: msg.payload.windowIdDest, index: indexTarget });

                    // Close window if empty
                    if (tabstruct.get(msg.payload.windowIdOrig)?.size === 0) {
                        tabstruct.delete(msg.payload.windowIdOrig);

                        try {
                            const win = await chrome.windows.get(msg.payload.windowIdOrig) ?? null;
                            if (win !== null)
                                await chrome.windows.remove(msg.payload.windowIdOrig);
                        } catch (error) {
                        }
                    }
                }

                await tabstructSet(tabstruct);
            }
            
            if (msg.payload.syncBypass === undefined) {
                chrome.runtime.sendMessage({
                    action: 'syncTabsList',
                    data: {
                        windowId: msg.payload.windowIdOrig
                    }
                }, (response) => {
                    if (chrome.runtime.lastError) {
                        return;
                    }
                });

                if (msg.payload.windowIdOrig !== msg.payload.windowIdDest) {
                    chrome.runtime.sendMessage({
                        action: 'syncTabsList',
                        data: {
                            windowId: msg.payload.windowIdDest
                        }
                    }, (response) => {
                        if (chrome.runtime.lastError) {
                            return;
                        }
                    });
                }
            }
        });
    }

    return false;
});



/**
 * Fired when a window is removed (closed).
 * @param {number} _window
 */
chrome.windows.onRemoved.addListener(async (_window) => {
    await mutexStorage.runExclusive(async () => {
        let tabstruct = await tabstructGet();
        if (tabstruct.has(_window)) {
            tabstruct.delete(_window);
            await tabstructSet(tabstruct);
        }
    });
});



/**
 * Fired when a tab is created. Note that the tab's URL and tab group membership may not be set at the time this event is fired,
 * but you can listen to onUpdated events so as to be notified when a URL is set or the tab is added to a tab group.
 * @param {Tab} _newTab
 */
chrome.tabs.onCreated.addListener(async (_newTab) => {
    // Because of Vivaldi
    if (_newTab.pendingUrl === `chrome-extension://${chrome.runtime.id}/sidebar.html`
        || _newTab.url === `chrome-extension://${chrome.runtime.id}/sidebar.html`) {
        return;
    }
    
    await mutexStorage.runExclusive(async () => {
        // Get the stored tabs structure
        let tabstruct = await tabstructGet();

        // Create the window's ID in the stored tab structure, if needed
        if (!tabstruct.has(_newTab.windowId)) {
            tabstruct.set(_newTab.windowId, new Map());
        }

        // Add the tab ID in this window's substructure
        if (_newTab.pinned) {
            //tabstruct.get(_newTab.windowId)?.set(_newTab.id, null);
            await processPinned(_newTab.id, true, _newTab.windowId, true);
        } else {
            let openerTabIsPinned = null;
            if (_newTab.openerTabId) {
                const openerTab = await chrome.tabs.get(_newTab.openerTabId) ?? null;
                openerTabIsPinned = openerTab.pinned;
            }

            if (openerTabIsPinned !== false)
                tabstruct.get(_newTab.windowId).set(_newTab.id, null);
            else {
                // 
                const tmp = new Map([...tabstruct.get(_newTab.windowId)].reverse());
                let indexCut = -2, i = 0;
                let checkForChild = false; // Found item is sibling which can have child too, so we need to scroll through the complete children list
                for (const [key, value] of tmp) {
                    if (value === _newTab.openerTabId       // ID last sibling
                        || key === _newTab.openerTabId) {   // ID parent
                        if (value === _newTab.openerTabId)
                            checkForChild = true;
                        indexCut = i;
                        break;
                    }
                    i++;
                }

                // 
                if (indexCut >= 0) {
                    if (checkForChild) {
                        let lastParentVisited = Array.from(tmp.keys())[indexCut];
                        let ret = null;
                        do {
                            ret = findLastChild(tmp, lastParentVisited);
                            if (ret.found === true) {
                                indexCut = ret.index;
                                lastParentVisited = Array.from(tmp.keys())[indexCut];
                            }
                        } while (ret.found === true);
                    }

                    // Cut in half at ID
                    const tmpP1 = new Map(Array.from(tmp.entries()).slice(0, indexCut));
                    const tmpP2 = new Map(Array.from(tmp.entries()).slice(indexCut));

                    // Merge both slices with [_newTab.id, _newTab.openerTabId || null] in between
                    const tmpTog = new Map([
                        ...Array.from(tmpP1.entries()),
                        [_newTab.id, _newTab.openerTabId || null],
                        ...Array.from(tmpP2.entries())
                    ]);

                    // Inverse order
                    const tmpTogRev = new Map([...(tmpTog)].reverse());

                    // Update tabstruct
                    tabstruct.set(_newTab.windowId, tmpTogRev);
                }
                else
                    tabstruct.get(_newTab.windowId).set(_newTab.id, _newTab.openerTabId);
            }
        }

        // Store the updated tabs structure
        await tabstructSet(tabstruct);

        // Send a request to the target window to create the tab to the sidepanel
        chrome.runtime.sendMessage({
            action: 'onCreated',
            data: {
                windowId: _newTab.windowId,
                tab: _newTab
            }
        }, (response) => {
            if (chrome.runtime.lastError) {
                return;
            }
        });
    });
});

/**
 * Fired when a tab is closed.
 * @param {number} _tabId
 * @param {object} _removeInfo
 */
chrome.tabs.onRemoved.addListener(async (_tabId, _removeInfo) => {
    await mutexStorage.runExclusive(async () => {
        // Get the stored tabs structure
        let tabstruct = await tabstructGet();

        // If the window's ID substructure exists
        if (tabstruct.has(_removeInfo.windowId)) {
            const tabIdExistsInWindow = tabstruct.get(_removeInfo.windowId)?.has(_tabId);
            let closeWindow = false;
            let parentTabID = null;

            // If the tab ID exists in this window's substructure
            if (tabIdExistsInWindow) {
                // Store the parent's tab ID
                parentTabID = tabstruct.get(_removeInfo.windowId)?.get(_tabId) ?? null;

                // Remove this tab ID
                tabstruct.get(_removeInfo.windowId).delete(_tabId);
            }

            // If this window's substructure is empty
            if (tabstruct.get(_removeInfo.windowId)?.size === 0) {
                // Remove this window's substructure
                tabstruct.delete(_removeInfo.windowId);
                closeWindow = true;
            }
            // Check the parentage
            else {
                let bFirstChildFound = false;
                for (const [key, value] of tabstruct.get(_removeInfo.windowId)) {
                    // The visited tab has as parent the removed tab
                    if (value === _tabId
                        && key !== _tabId) {
                        // Looking for the first child
                        if (!bFirstChildFound) {
                            bFirstChildFound = true;
                            // This child of the removed tab now becomes the child of the parent of the removed tab
                            tabstruct.get(_removeInfo.windowId).set(key, parentTabID);
                            // Update the parent tab ID for the siblings of the visited tab
                            parentTabID = key;
                        } else {
                            // This removed tab's child becomes the child of its first sibling
                            tabstruct.get(_removeInfo.windowId).set(key, parentTabID);
                        }
                    }
                }
            }

            // Store the updated tabs structure
            await tabstructSet(tabstruct);

            // Close the empty window
            if (closeWindow) {
                try {
                    const win = await chrome.windows.get(_removeInfo.windowId) ?? null;
                    if (win !== null)
                        await chrome.windows.remove(_removeInfo.windowId);
                } catch (error) {
                }
            // Send a request to the target window to remove the tab from the sidepanel
            } else {
                chrome.runtime.sendMessage({
                    action: 'onRemoved',
                    data: {
                        windowId: _removeInfo.windowId,
                        tabId: _tabId
                    }
                }, (response) => {
                    if (chrome.runtime.lastError) {
                        return;
                    }
                });
            }
        }
    });
});

/**
 * Fired when properties of a tab are updated
 * @param {number} _tabId
 * @param {object} _changeInfo
 * @param {Tab} _tab
 */
chrome.tabs.onUpdated.addListener(async (_tabId, _changeInfo, _tab) => {
    if (_changeInfo.pinned !== undefined) {
        await mutexStorage.runExclusive(async () => {
            await processPinned(_tabId, _changeInfo.pinned, _tab.windowId, false);
        });
    }
});

/**
 * Fired when a tab is discarded/frozen, and also when reactivated
 * @param {number} addedTabId
 * @param {number} removedTabId
 */
chrome.tabs.onReplaced.addListener(async (addedTabId, removedTabId) => {
    return await mutexStorage.runExclusive(async () => {
        const tabNew = await chrome.tabs.get(addedTabId);
        let tabstruct = await tabstructGet();

        if (tabstruct.has(tabNew.windowId)) {
            let tmp = tabstruct.get(tabNew.windowId);

            const tabParent = tmp.get(removedTabId);
            const indexOldTab = Array.from(tmp.keys()).indexOf(removedTabId);

            const tmp1 = indexOldTab > 0 ? new Map(Array.from(tmp.entries()).slice(0, indexOldTab)) : new Map();
            const tmp2 = indexOldTab + 1 < tmp.size ? new Map(Array.from(tmp.entries()).slice(indexOldTab + 1)) : new Map();
            const tmpTog = new Map([
                ...Array.from(tmp1.entries()),
                [addedTabId, tabParent],
                ...Array.from(tmp2.entries())
            ]);

            tabstruct.set(tabNew.windowId, tmpTog);
            await tabstructSet(tabstruct);

            await chrome.runtime.sendMessage({
                action: 'onReplaced',
                data: {
                    windowId: tabNew.windowId,
                    addedTabId,
                    removedTabId
                }
            }, (response) => {
                if (chrome.runtime.lastError) {
                    return;
                }
            });
        }
    });
});



/**
 * Returns the side panel's current layout.
 */
chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((error) => console.error(error));