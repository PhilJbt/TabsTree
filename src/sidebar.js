document.addEventListener("DOMContentLoaded", async function (event) {
	/**
	 * Mutex, used to lock DOM during its modification
	 */
	class Mutex {
	  constructor() {
		this._queue = [];
		this._locked = false;
	  }

	  acquire() {
		return new Promise(resolve => {
		  this._queue.push(resolve);
		  this._dispatch();
		});
	  }

	  async runExclusive(fn) {
		const release = await this.acquire();
		try {
		  return await fn();
		} finally {
		  release();
		}
	  }

	  _dispatch() {
		if (this._locked) return;
		const next = this._queue.shift();
		if (!next) return;
		this._locked = true;
		next(() => {
		  this._locked = false;
		  this._dispatch();
		});
	  }
	}

	/**
	 * Global vars
	 */
	const mutexDOM       		 = new Mutex();
	let   myWindowId 	 		 = null;
	const contTabsPinned 		 = document.querySelector('#pinned-tabs-container');
	const contTabsNormal 		 = document.querySelector('#normal-tabs-container');
	const contCntxMenu   		 = document.querySelector('#context-menu-container');
	const contCntxMenu_subdiv1   = document.createElement('div');
	const contCntxMenu_divider   = document.createElement('div');
	const contCntxMenu_subdiv2   = document.createElement('div');
	const contCntxMenu_mute 	 = document.createElement('img');
	const contCntxMenu_pin 		 = document.createElement('img');
	const contCntxMenu_refresh 	 = document.createElement('img');
	const contCntxMenu_copyurl 	 = document.createElement('img');
	const contCntxMenu_duplicate = document.createElement('img');
	const contCntxMenu_bookmark  = document.createElement('img');
	const contCntxMenu_hibernate = document.createElement('img');
	const contCntxMenu_close 	 = document.createElement('img');
	const contCntxMenu_newtab 	 = document.createElement('img');
	const contCntxMenu_reopen 	 = document.createElement('img');
	let   contextMenu_targetID   = -1;



	/**
	 * Shows in the logs the callers of the function
	 */
	function TRACE() {
	  const stack = new Error().stack.split("\n");

	  console.log(
	  	'[TRACE]',
	  	stack[2] || '[N/R #1]',
	  	stack[3] || '[N/R #2]',
	  	stack[4] || '[N/R #3]',
	  	Date.now()
	  	);
	}



	/**
	 * Retrieves the tab structure for a specific windowId
	 * @returns {Map<number, number||null>} Map of tabs hierarchy for the current windowId
	 */
	async function tabstructGet() {
		let result = null;

		result = await chrome.runtime.sendMessage({
		  type: 'tabstruct',
		  payload: { windowId: myWindowId }
		});

		if (!result || !Array.isArray(result)) {
	        return new Map();
	    }

		for (const [windowId, windowData] of result) {
	        if (windowId === myWindowId) {
	            return Array.isArray(windowData) 
	                ? new Map(windowData) 
	                : new Map(Object.entries(windowData || {}));
	        }
	    }

	    return new Map();
	}

	/**
	 * Description
	 * @param {number} tabId - The ID of the tab
	 * @returns {Promise<Tab>} Properties of the tab
	 */
	function queryTabInfo(tabId) {
	    return new Promise((resolve) => {
	        chrome.tabs.get(tabId, resolve);
	    });
	}

	/**
	 * Calculate how deep far the tab is in the hierarchy, used of HTML tab indentation
	 * @param {Map<number, number||null>} _tabstruct - Map of tabs hierarchy for the current windowId
	 * @param {number} _tabElem - ID of the tab
	 * @returns {number} Ascendants count
	 */
	function tabLevelCalc(_tabstruct, _tabElem) {
		let tabParentID = _tabstruct.get(_tabElem) ?? null;
		let tabLevel = 0;
		while (tabParentID && _tabstruct.get(tabParentID) !== undefined) {
			++tabLevel;
			tabParentID = _tabstruct.get(tabParentID);
		};
		return tabLevel;
	}

	

	/**
	 * Set the Y position of the Right-click context menu of a tab
	 * @param {Object} e - addEventListener event
	 */
	function contextMenu_setPos(e) {
		const mouseY = e.clientY;

		const rect = document.body.getBoundingClientRect();
		const containerHeight = rect.height;

		let divY = mouseY - rect.top;
		const divHeight = contCntxMenu.offsetHeight;
		if (divY + divHeight > containerHeight) divY = containerHeight - divHeight - 40;
		if (divY < 0) divY = 10;

		contCntxMenu.style.top = divY + 'px';
		contCntxMenu.style.display = 'block';
	}

	/**
	 * Hide the content of the context menu
	 */
	function contextMenu_hide() {
		//return; // DEBUG
		contCntxMenu.style.display = 'none';
	}

	/**
	 * Show the content of the context menu
	 */
	function contextMenu_show(forTab = false, event = null) {
		if (forTab && event.ctrlKey)
			contCntxMenu.classList.add('special');
		else
			contCntxMenu.classList.remove('special');

		if (forTab) {
			contCntxMenu_subdiv1.style.display = 'flex';
			contCntxMenu_divider.style.display = 'block';
		} else {
			contCntxMenu_subdiv1.style.display = 'none';
			contCntxMenu_divider.style.display = 'none';
		}

		contCntxMenu.style.display = 'flex';
	}

	

	/**
	 * Create the Mute button into the Right-click context menu
	 */
	function createContextMenu_mute() {
		return new Promise((resolve) => {
			contCntxMenu_mute.src = chrome.runtime.getURL('images/icons/volume-xmark-solid-full.svg');
			contCntxMenu_mute.classList.add('context-menu-button', 'mute');
			contCntxMenu_mute.title = chrome.i18n.getMessage('mute');
			contCntxMenu_mute.addEventListener('pointerup', async (event) => {
				if (event.button !== 0
				|| !event.target.classList.contains('context-menu-button', 'mute')) return;
				event.stopImmediatePropagation();
				contextMenu_hide();

				const tabInfo = await queryTabInfo(contextMenu_targetID);
				if (tabInfo)
					chrome.tabs.update(contextMenu_targetID, {muted: !tabInfo?.mutedInfo?.muted ?? false});
				contextMenu_targetID = -1;
			}, { passive: false });

		    resolve();
		});
	}

	/**
	 * Create the Pin button into the Right-click context menu
	 */
	function createContextMenu_pin() {
		return new Promise((resolve) => {
			contCntxMenu_pin.src = chrome.runtime.getURL('images/icons/thumbtack-solid-full.svg');
			contCntxMenu_pin.classList.add('context-menu-button', 'pin');
			contCntxMenu_pin.title = chrome.i18n.getMessage('pin');
			contCntxMenu_pin.addEventListener('pointerup', async (event) => {
				if (event.button !== 0
				|| !event.target.classList.contains('context-menu-button', 'pin')) return;
				event.stopImmediatePropagation();
				contextMenu_hide();

				const tabInfo = await queryTabInfo(contextMenu_targetID);
				if (tabInfo)
					chrome.tabs.update(contextMenu_targetID, {pinned: !tabInfo.pinned ?? false});
				contextMenu_targetID = -1;
			}, { passive: false });

		    resolve();
		});
	}

	/**
	 * Create the Refresh button into the Right-click context menu
	 */
	function createContextMenu_refresh() {
		return new Promise((resolve) => {
			contCntxMenu_refresh.src = chrome.runtime.getURL('images/icons/retweet-solid-full.svg');
			contCntxMenu_refresh.classList.add('context-menu-button', 'refresh');
			contCntxMenu_refresh.title = chrome.i18n.getMessage('refresh');
			contCntxMenu_refresh.addEventListener('pointerup', (event) => {
				if (event.button !== 0
				|| !event.target.classList.contains('context-menu-button', 'refresh')) return;
				event.stopImmediatePropagation();
				contextMenu_hide();

				if (contCntxMenu.classList.contains('special'))
					chrome.tabs.reload(contextMenu_targetID, { bypassCache: true });
				else
					chrome.tabs.reload(contextMenu_targetID, {});
				contextMenu_targetID = -1;
			}, { passive: false });

		    resolve();
		});
	}

	/**
	 * Create the Copy URL button into the Right-click context menu
	 */
	function createContextMenu_copyurl() {
		return new Promise((resolve) => {
			contCntxMenu_copyurl.src = chrome.runtime.getURL('images/icons/link-solid-full.svg');
			contCntxMenu_copyurl.classList.add('context-menu-button', 'copyurl');
			contCntxMenu_copyurl.title = chrome.i18n.getMessage('copyurl');
			contCntxMenu_copyurl.addEventListener('pointerup', async (event) => {
				if (event.button !== 0
				|| !event.target.classList.contains('context-menu-button', 'copyurl')) return;
				event.stopImmediatePropagation();
				contextMenu_hide();

				const tabInfo = await queryTabInfo(contextMenu_targetID);
				if (tabInfo)
					navigator.clipboard.writeText(tabInfo.url);
				contextMenu_targetID = -1;
			}, { passive: false });

		    resolve();
		});
	}

	/**
	 * Create the Duplicate button into the Right-click context menu
	 */
	function createContextMenu_duplicate() {
		return new Promise((resolve) => {
			contCntxMenu_duplicate.src = chrome.runtime.getURL('images/icons/clone-solid-full.svg');
			contCntxMenu_duplicate.classList.add('context-menu-button', 'duplicate');
			contCntxMenu_duplicate.title = chrome.i18n.getMessage('duplicate');
			contCntxMenu_duplicate.addEventListener('pointerup', async (event) => {
				if (event.button !== 0
				|| !event.target.classList.contains('context-menu-button', 'duplicate')) return;
				event.stopImmediatePropagation();
				contextMenu_hide();
				
				const tabInfo = await queryTabInfo(contextMenu_targetID);
				const tabDup = await chrome.tabs.create({
				  windowId: tabInfo.windowId,
				  index: tabInfo.index,
				  url: tabInfo.url,
				  active: false
				});

				chrome.runtime.sendMessage({
					type: 'movetabs',
					payload: {
						windowIdOrig: tabInfo.windowId,
						windowIdDest: tabInfo.windowId,
						tabIdMoving: tabDup.id,
						tabIdTarget: contextMenu_targetID,
						movingAbove: true,
						itemsNumber: 1,
						syncBypass: false
					}
				});

				contextMenu_targetID = -1;
			}, { passive: false });

		    resolve();
		});
	}

	/**
	 * Create the Bookmark button into the Right-click context menu
	 */
	function createContextMenu_bookmark() {
		return new Promise((resolve) => {
			contCntxMenu_bookmark.src = chrome.runtime.getURL('images/icons/bookmark-solid-full.svg');
			contCntxMenu_bookmark.classList.add('context-menu-button', 'bookmark');
			contCntxMenu_bookmark.title = chrome.i18n.getMessage('bookmark');
			contCntxMenu_bookmark.addEventListener('pointerup', async (event) => {
				if (event.button !== 0
				|| !event.target.classList.contains('context-menu-button', 'bookmark')) return;
				event.stopImmediatePropagation();
				contextMenu_hide();

				const tabInfo = await queryTabInfo(contextMenu_targetID);
				const BOOKMARKS_BAR_ID = "1";

				if (tabInfo) {
					if (contCntxMenu.classList.contains('special')
						&& !tabInfo.pinned) {
						let links = [{ title: tabInfo.title, url: tabInfo.url }];
						const tabstruct = await tabstructGet();
						for (const [key, val] of tabstruct) {
							if (val === contextMenu_targetID) {
								const childInfo = await queryTabInfo(key);
								links.push({ title: childInfo.title, url: childInfo.url });
							}
						}

						chrome.bookmarks.create(
						  { parentId: BOOKMARKS_BAR_ID, title: tabInfo.url },
						  (folder) => {
						    links.forEach((b) => {
						      chrome.bookmarks.create({ parentId: folder.id, title: b.title, url: b.url });
						    });
						  }
						);
					} else {
						chrome.bookmarks.getChildren(BOOKMARKS_BAR_ID, (children) => {
							chrome.bookmarks.create({
								parentId: BOOKMARKS_BAR_ID,
								index: children.length,
								title: tabInfo.title,
								url: tabInfo.url
							});
						});
					}
				}

				contextMenu_targetID = -1;
			}, { passive: false });

		    resolve();
		});
	}

	/**
	 * Create the Hibernate button into the Right-click context menu
	 */
	function createContextMenu_hibernate() {
		return new Promise((resolve) => {
			contCntxMenu_hibernate.src = chrome.runtime.getURL('images/icons/snowflake-solid-full.svg');
			contCntxMenu_hibernate.classList.add('context-menu-button', 'hibernate');
			contCntxMenu_hibernate.title = chrome.i18n.getMessage('hibernate');
			contCntxMenu_hibernate.addEventListener('pointerup', (event) => {
				if (event.button !== 0
				|| !event.target.classList.contains('context-menu-button', 'hibernate')
				|| contCntxMenu_hibernate.hasAttribute('inert')) return;
				event.stopImmediatePropagation();
				contextMenu_hide();

				chrome.tabs.discard(contextMenu_targetID);
				contextMenu_targetID = -1;
			}, { passive: false });

		    resolve();
		});
	}

	/**
	 * Create the Close button into the Right-click context menu
	 */
	function createContextMenu_close() {
		return new Promise((resolve) => {
			contCntxMenu_close.src = chrome.runtime.getURL('images/icons/xmark-solid-full.svg');
			contCntxMenu_close.classList.add('context-menu-button', 'close');
			contCntxMenu_close.title = chrome.i18n.getMessage('close');
			contCntxMenu_close.addEventListener('pointerup', async (event) => {
				if (event.button !== 0
				|| !event.target.classList.contains('context-menu-button', 'close')) return;
				event.stopImmediatePropagation();
				contextMenu_hide();

				const tabInfo = await queryTabInfo(contextMenu_targetID);

				if (tabInfo
				&& !tabInfo.pinned) {
					const tabDom = document.querySelector(`.tab-item-pinned[data-tab-id="${contextMenu_targetID}"]`);
					if (tabDom)
						tabDom.setAttribute('inert', '');

					if (contCntxMenu.classList.contains('special')) {
						let tabsToClose = [contextMenu_targetID];
						let idToVisit = [contextMenu_targetID];
						const tabstruct = await tabstructGet();
						while (idToVisit.length > 0) {
							for (const [key, val] of tabstruct) {
								if (val === idToVisit[0]) {
									idToVisit.push(key);
									tabsToClose.push(key);
								}
							}
							idToVisit.shift();
						}

						await chooseTabToActivate(tabsToClose[0]);
						chrome.tabs.remove(tabsToClose);
					} else {
						await chooseTabToActivate(contextMenu_targetID);
						chrome.tabs.remove(contextMenu_targetID);
					}
				}

				contextMenu_targetID = -1;
			}, { passive: false });

		    resolve();
		});
	}

	/**
	 * Create the New tab button into the Right-click context menu
	 */
	function createContextMenu_newtab() {
		return new Promise((resolve) => {
			contCntxMenu_newtab.src = chrome.runtime.getURL('images/icons/plus-solid-full.svg');
			contCntxMenu_newtab.classList.add('context-menu-button', 'newtab');
			contCntxMenu_newtab.title = chrome.i18n.getMessage('newtab');
			contCntxMenu_newtab.addEventListener('pointerup', async (event) => {
				if (event.button !== 0
				|| !event.target.classList.contains('context-menu-button', 'newtab')) return;
				event.stopImmediatePropagation();
				contextMenu_hide();

				if (contextMenu_targetID === -1) {
					chrome.tabs.create({
						url: await optionGet("defaulturl"),
						active: false
					});
				}
				else {
					const tabInfo = await queryTabInfo(contextMenu_targetID);

					if (tabInfo) {
						if (contCntxMenu.classList.contains('special')
							&& !tabInfo.pinned) {
							const tabNew = await chrome.tabs.create({
							  windowId: tabInfo.windowId,
							  index: tabInfo.index,
							  url: await optionGet("defaulturl"),
							  active: false
							});

							chrome.runtime.sendMessage({
								type: 'movetabs',
								payload: {
									windowIdOrig: tabInfo.windowId,
									windowIdDest: tabInfo.windowId,
									tabIdMoving: tabNew.id,
									tabIdTarget: contextMenu_targetID,
									movingAbove: false,
									itemsNumber: 1,
									syncBypass: true
								}
							});
						} else {
							chrome.tabs.create({
							  url: await optionGet("defaulturl"),
							  active: false
							});
						}
					}
				}

				contextMenu_targetID = -1;
			}, { passive: false });

		    resolve();
		});
	}

	/**
	 * Create the Reopen button into the Right-click context menu
	 */
	function createContextMenu_reopen() {
		return new Promise((resolve) => {
			contCntxMenu_reopen.src = chrome.runtime.getURL('images/icons/arrow-up-right-from-square-solid-full.svg');
			contCntxMenu_reopen.classList.add('context-menu-button', 'reopen');
			contCntxMenu_reopen.title = chrome.i18n.getMessage('reopen');
			contCntxMenu_reopen.addEventListener('pointerup', (event) => {
				if (event.button !== 0
				|| !event.target.classList.contains('context-menu-button', 'reopen')) return;
				event.stopImmediatePropagation();
				contextMenu_hide();

				chrome.sessions.getRecentlyClosed({ maxResults: 1 }, (sessions) => {
					const s = sessions?.[0];
					if (!s) return;

					const sessionId = s.tab?.sessionId ?? s.window?.sessionId;
					if (!sessionId) return;

					chrome.sessions.restore(sessionId);
				});

				contextMenu_targetID = -1;
			}, { passive: false });

		    resolve();
		});
	}

	/**
	 * Create the Right-click context menu
	 */
	async function createContextMenu() {
		contCntxMenu_subdiv1.classList.add('context-menu-subdiv');
		contCntxMenu_divider.classList.add('context-menu-divider');
		contCntxMenu_subdiv2.classList.add('context-menu-subdiv');
		
		await Promise.all([
			createContextMenu_mute(),
			createContextMenu_pin(),
			createContextMenu_refresh(),
			createContextMenu_copyurl(),
			createContextMenu_duplicate(),
			createContextMenu_bookmark(),
			createContextMenu_hibernate(),
			createContextMenu_close(),
			createContextMenu_newtab(),
			createContextMenu_reopen()
		]);

		contCntxMenu_subdiv1.append(contCntxMenu_mute);
		contCntxMenu_subdiv1.append(contCntxMenu_pin);
		contCntxMenu_subdiv1.append(contCntxMenu_refresh);
		contCntxMenu_subdiv1.append(contCntxMenu_copyurl);
		contCntxMenu_subdiv1.append(contCntxMenu_duplicate);
		contCntxMenu_subdiv1.append(contCntxMenu_bookmark);
		contCntxMenu_subdiv1.append(contCntxMenu_hibernate);
		contCntxMenu_subdiv1.append(contCntxMenu_close);
		contCntxMenu_subdiv2.append(contCntxMenu_newtab);
		contCntxMenu_subdiv2.append(contCntxMenu_reopen);

		contCntxMenu.append(contCntxMenu_subdiv1);
		contCntxMenu.append(contCntxMenu_divider);
		contCntxMenu.append(contCntxMenu_subdiv2);
	}



	/**
	 * Define the best tab to activate, depending on the tab provided which is going to be closed
	 * @param {number} _tabIdToRemove - ID of the tab which is going to be closed 
	 * @param {bool} _postEvent - If true, the closing has been initiated by the browser (and not by Tabstree),
	 * which means the tab is already closed. It is therefore necessary to determine which tab to activate, but without having its direct ascendant.
	 */
	async function chooseTabToActivate(_tabIdToRemove, _postEvent = false) {
		await mutexDOM.runExclusive(async () => {
			// Tabstree was not the reason for the closure
			if (_postEvent) {
				const activeTabs = await chrome.tabs.query({
		            active: true,
		            windowId: myWindowId
		        });

				// If there is no tab currently active
		        if (activeTabs.length === 0) {
		        	const structWnd = await tabstructGet();
		            const arrTabs = Array.from(structWnd.keys())
		            let nearestId = Number.MAX_SAFE_INTEGER;

		            for (const tabId of arrTabs) {
		            	if (Math.abs(tabId - _tabIdToRemove) < Math.abs(nearestId - _tabIdToRemove)) {
		            		nearestId = tabId;
		            	}
		            }

		            if (nearestId !== Number.MAX_SAFE_INTEGER)
	        			chrome.tabs.update(nearestId, { active: true });
				}
			}
			// Tabstree was the reason for the closure
			else {
				const activeTabs = await chrome.tabs.query({
		            active: true,
		            windowId: myWindowId
		        });

		        if (activeTabs.length === 0
		        	|| _tabIdToRemove === activeTabs[0].id) {
		        	let tabIdActivate = null;
		        	const structWnd = await tabstructGet();
		            const indexTab = Array.from(structWnd.keys()).indexOf(_tabIdToRemove);
		            const arrTabs = Array.from(structWnd.entries());
		        	const parentTabID = arrTabs[indexTab][1];

		        	// Does the next element is its child
		        	if (indexTab < arrTabs.length - 1
		        		&& arrTabs[indexTab + 1][1] === _tabIdToRemove) {
		        		tabIdActivate = arrTabs[indexTab + 1][0];
		        	}

		            // Looking for the next sibling
		            if (tabIdActivate === null) {
			            for (let i = indexTab + 1; i < arrTabs.length; ++i) {
			                if (arrTabs[i][1] === parentTabID) {
			                    tabIdActivate = arrTabs[i][0];
			                    break;
			                }
			            }
			        }

		            // Looking for the previous sibling
		            if (tabIdActivate === null) {
		                for (let i = indexTab - 1; i >= 0; --i) {
		                    if (arrTabs[i][1] === parentTabID) {
		                        tabIdActivate = arrTabs[i][0];
		                        break;
		                    }
		                }
		            }

		            // Looking for the parent
		            if (tabIdActivate === null) {
		                for (let i = indexTab - 1; i >= 0; --i) {
		                    if (arrTabs[i][0] === parentTabID) {
		                        tabIdActivate = arrTabs[i][0];
		                        break;
		                    }
		                }
		            }

		            // Security
		            if (tabIdActivate === null
		            	&& structWnd.length > 0) {
		                tabIdActivate = Array.from(structWnd.keys())[0];
		            }

		            // Activate the specified tab
		            if (tabIdActivate !== null) {
		                chrome.tabs.update(tabIdActivate, { active: true });
		            }
		        }
	        }
	    });
	}



	/**
	 * If the favicon source is not provided, attempt to determine whether a favicon can be displayed based on the context (Chrome Extension page or MIME type)
	 * @param {string} - Url of the page itself, not the src of the favicon
	 * @return {string} - Url of the favicon
	 */
	function faviconFromUrl(_url) {
		try {
			const url = new URL(_url);

			if (url.pathname.lastIndexOf('.') !== -1) {
				const fileExtension = url.pathname.substr(url.pathname.lastIndexOf('.'));

				switch (fileExtension) {
				case '.apng':
				case '.avif':
				case '.bmp':
				case '.cur':
				case '.gif':
				case '.ico':
				case '.jpeg':
				case '.jpg':
				case '.png':
				case '.svg':
				case '.tif':
				case '.tiff':
				case '.webp':
					return { knownType: true, src: chrome.runtime.getURL('images/filetypes/file-image-solid-full.svg') };
					break;
				case '.flac':
				case '.m4a':
				case '.mp3':
				case '.ogg':
				case '.wav':
					return { knownType: true, src: chrome.runtime.getURL('images/filetypes/file-audio-solid-full.svg') };
					break;
				case '.avi':
				case '.mkv':
				case '.mov':
				case '.mp4':
				case '.mpg':
				case '.mpeg':
				case '.webm':
					return { knownType: true, src: chrome.runtime.getURL('images/filetypes/file-video-solid-full.svg') };
					break;
				case '.c':
				case '.css':
				case '.cpp':
				case '.dat':
				case '.md':
				case '.js':
				case '.json':
				case '.php':
				case '.py':
				case '.xml':
					return { knownType: true, src: chrome.runtime.getURL('images/filetypes/file-code-solid-full.svg') };
					break;
				case '.text':
				case '.txt':
					return { knownType: true, src: chrome.runtime.getURL('images/filetypes/file-lines-solid-full.svg') };
					break;
				case '.svg':
					return { knownType: true, src: chrome.runtime.getURL('images/filetypes/file-contract-solid-full.svg') };
					break;
				case '.pdf':
					return { knownType: true, src: chrome.runtime.getURL('images/filetypes/file-pdf-solid-full.svg') };
					break;
				}
			}

			if (_url.substr(0, 9) === 'chrome://'
				|| _url.substr(0, 19) === 'chrome-extension://')
				return { knownType: true, src: chrome.runtime.getURL('images/chrome-32.png') };
			else
				return { knownType: false, src: null };
		} catch (error){
			return { knownType: false, src: null };
		}
	}



	/**
	 * Create a new tab in the DOM
	 * @param {Promise<Tab>} _newTab - Properties of the tab
	 * @param {Map<number, number||null>} _tabstruct - Map of tabs hierarchy for the current windowId
	 */
	async function onCreated(_newTab, _tabstruct) {
		await mutexDOM.runExclusive(async () => {
			const tabType = _newTab.pinned ? 'pinned' : 'normal';

			if (!document.querySelector(`.tab-item-${tabType}[data-tab-id="${_newTab.id}"]`)) {
				const container = _newTab.pinned ? contTabsPinned : contTabsNormal;
				const newTab = await createTab(_tabstruct, _newTab, _newTab.id, container, tabType);

				// Highlight the active tab
				if (newTab
					&& _newTab.active) {
					const arrTabsDOM = document.querySelectorAll('.tab-item-pinned.active, .tab-item-normal.active');
					arrTabsDOM.forEach(tabDOM => {
						tabDOM.classList.remove('active');
					});
					newTab.classList.add('active');
				}
			}
			requestAnimationFrame(() => {
				null;
			});
		});
	}

	/**
	 * Remove a tab from the DOM
	 * @param {number} _tabElem - ID of the tab
	 * @param {Map<number, number||null>} _tabstruct - Map of tabs hierarchy for the current windowId
	 */
	async function onRemoved(_tabId, _tabstruct) {
		await mutexDOM.runExclusive(async () => {
			const tabDOM = document.querySelector(`*[data-tab-id="${_tabId}"]`);

			if (tabDOM) {
				const tabIsNormal = tabDOM.parentNode.id === 'normal-tabs-container';
				tabDOM.remove();

				if (tabIsNormal) {
					for (const tabId of _tabstruct.keys()) {
						const tabLevel = tabLevelCalc(_tabstruct, tabId);
						if (contTabsNormal.querySelector(`.tab-item-normal[data-tab-id="${tabId}"]`))
							contTabsNormal.querySelector(`.tab-item-normal[data-tab-id="${tabId}"]`).setAttribute('data-tab-level', tabLevel);
					}
				}
			}

			requestAnimationFrame(() => {
				null;
			});
		});
	}

	/**
	 * Replace a tab ID in the DOM by its new ID
	 * @param {number} addedTabId - New ID of the tab
	 * @param {number} removedTabId - Tab ID to renew
	 */
	async function onReplaced(addedTabId, removedTabId) {
		await mutexDOM.runExclusive(async () => {
			const tabDOM = document.querySelector(`*[data-tab-id="${removedTabId}"]`);

			if (tabDOM) {
				tabDOM.dataset.tabId = addedTabId;
				const statusBar = tabDOM.querySelector('.tab-item-status');
				statusBar.classList.remove('hibernated');
				void statusBar.offsetWidth;
				statusBar.classList.add('hibernated');
			}

			requestAnimationFrame(() => {
				null;
			});
		});
	}

	/**
	 * Description
	 * @param {number} _tabId - ID of the tab
	 * @param {object} _changeInfo - Tab properties that are modified
	 * @param {object} _tab - Tab properties
	 */
	async function onUpdated(_tabId, _changeInfo, _tab) {
		try {
			const tabElem = document.querySelector(`.tab-item-pinned[data-tab-id="${_tabId}"], .tab-item-normal[data-tab-id="${_tabId}"]`) || null;
			if (tabElem) {
				// Muted
				if (_changeInfo.mutedInfo !== undefined) {
					const statusElem = tabElem.querySelector('.tab-item-status') || null;
					if (_changeInfo.mutedInfo.muted)
						statusElem.classList.add('muted');
					else
						statusElem.classList.remove('muted');
				}
				// Audible
				if (_changeInfo.audible !== undefined) {
					const statusElem = tabElem.querySelector('.tab-item-status') || null;
					if (_changeInfo.audible)
						statusElem.classList.add('audible');
					else
						statusElem.classList.remove('audible');
				}
				// Title
				if (_changeInfo.title !== undefined) {
					const titleElem = tabElem.querySelector('.tab-item-title') || null;
					tabElem.title = _changeInfo.title;
					if (titleElem)
						titleElem.innerHTML = _changeInfo.title;
				}
				// Favicon
				if (_changeInfo.favIconUrl !== undefined) {
					const faviconElem = tabElem.querySelector('.tab-item-favicon') || null;
					faviconElem.onerror = function() {
						this.onerror = function() {
						    this.src = chrome.runtime.getURL('images/blank-24.png');
						    this.classList.add('empty');
						    this.onerror = null;
						};
				
						if ((_tab.url || _tab.pendingUrl).substr(0, 9) === 'chrome://'
						|| (_tab.url || _tab.pendingUrl).substr(0, 19) === 'chrome-extension://') {
							this.src = chrome.runtime.getURL('images/chrome-32.png');
							this.classList.remove('empty');
							this.onerror = null;
						}
						else {
							this.src = `https://www.google.com/s2/favicons?domain=${this.src}&sz=24`;
							this.classList.remove('empty');
						}
					};

					if (_changeInfo.favIconUrl
						&& _changeInfo.favIconUrl !== '') {
						faviconElem.src = _changeInfo.favIconUrl;
						faviconElem.classList.remove('empty');
					}
					else if (_tab.url || _tab.pendingUrl) {
						const ret = faviconFromUrl(_tab.url || _tab.pendingUrl);

						if (ret.knownType === true) {
							faviconElem.src = ret.src;
							faviconElem.classList.remove('empty');
						}
					}
				}
				// Loading progression
				if (_changeInfo.status !== undefined) {
					if (_changeInfo.status === 'complete') {
						if (_tab.favIconUrl === undefined
							|| _tab.favIconUrl === '') {
							const faviconElem = tabElem.querySelector('.tab-item-favicon') || null;
							if (faviconElem
							&& ((_tab.url || _tab.pendingUrl).substr(0, 9) === 'chrome://'
							|| (_tab.url || _tab.pendingUrl).substr(0, 19) === 'chrome-extension://')) {
								faviconElem.src = chrome.runtime.getURL('images/chrome-32.png');
								faviconElem.onerror = null;
								faviconElem.classList.remove('empty');
							}
						}

						const titleElem = tabElem.querySelector('.tab-item-title') || null;
						const tabInfo = await chrome.tabs.get(_tabId);
						if (tabInfo) {
							if (tabElem.title === '')
								tabElem.title = tabInfo.url;
							if (titleElem
								&& titleElem.innerHTML === '') {
								titleElem.innerHTML = tabInfo.url;
							}
						}
					}
				}
				// Discarded / frozen
				if (_changeInfo.discarded !== undefined
					|| _changeInfo.hibernate !== undefined) {
					const statusElem = tabElem.querySelector('.tab-item-status') || null;
					void statusElem.offsetWidth;
					if (_changeInfo.discarded === true || _changeInfo.hibernate === true)
						statusElem.classList.add('hibernated');
					else
						statusElem.classList.remove('hibernated');
				}
			}

			requestAnimationFrame(() => {
				null;
			});
		} catch (error) {
		}
	}

	/**
	 * Checks if all existing tabs in the DOM are present in the stored hierarchical structure and,
	 * in case of discrepancies, modifies the DOM accordingly
	 * @param {bool} _purge - Does the contents of the DOM tab containers must be purged.
	 */
	async function syncTabsList(_purge = false) {
		await mutexDOM.runExclusive(async () => {
			await chrome.tabs.query({ currentWindow: true }, async function(tabs) {
				const tabstruct = await tabstructGet();

				if (_purge) {
					contTabsPinned.innerHTML = '';
					contTabsNormal.innerHTML = '';
				}

				const arrIDsPinned = tabs
				.filter(tab => tab.pinned)
				.map(tab => tab.id);

				const arrIDsNormal = tabs
				.filter(tab => !tab.pinned)
				.map(tab => tab.id);

				// Remove tabs existing in DOM but not existing in Chrome
				const arrDomTabsPinned = document.querySelectorAll('.tab-item-pinned');
				for (const tabItem of arrDomTabsPinned)
					if (!arrIDsPinned.includes(parseInt(tabItem.dataset.tabId || '-1')))
	 					tabItem.remove();

				const arrDomTabsNormal = document.querySelectorAll('.tab-item-normal');
				for (const tabItem of arrDomTabsNormal)
					if (!arrIDsNormal.includes(parseInt(tabItem.dataset.tabId || '-1')))
	 					tabItem.remove();

				// Add tabs not existing in DOM but existing in Chrome
				for (const tabID of tabstruct.keys()) {
					if (arrIDsPinned.includes(tabID)
						&& !contTabsPinned.querySelector(`[data-tab-id="${tabID}"]`)) {
						const tabInfo = tabs.find(t => t.id === tabID);
						await createTab(tabstruct, tabInfo, tabID, contTabsPinned, 'pinned');
					}
				}

				for (const tabID of tabstruct.keys()) {
					if (arrIDsNormal.includes(tabID)) {
						if (!contTabsNormal.querySelector(`[data-tab-id="${tabID}"]`)) {
							const tabInfo = tabs.find(t => t.id === tabID);
							await createTab(tabstruct, tabInfo, tabID, contTabsNormal, 'normal');
						// While we're at it, check if already existing tabs' level is still the same
						} else {
							const tabLevel = tabLevelCalc(tabstruct, tabID);
							contTabsNormal.querySelector(`[data-tab-id="${tabID}"]`).setAttribute('data-tab-level', tabLevel);
						}
					}
				}

				// Doesn't seem necessary at the moment:
			 	/*
			 	// Check tabs order

				if (desync) {
					syncTabsList(true);
					return;
				}
				*/

				// Highlight the active tab
				const arrTabsDOM = document.querySelectorAll('.tab-item-pinned.active, .tab-item-normal.active');
				arrTabsDOM.forEach(tabDOM => {
					tabDOM.classList.remove('active');
				});
				const [tabActiveInfos] = await chrome.tabs.query({
					active: true,
				    windowId: myWindowId
				});
				if (tabActiveInfos) {
					const tabActiveHTML = document.querySelector(`.tab-item-pinned[data-tab-id="${tabActiveInfos.id}"], .tab-item-normal[data-tab-id="${tabActiveInfos.id}"]`);
					if (tabActiveHTML)
						tabActiveHTML.classList.add('active');
				}

				requestAnimationFrame(() => {
					null;
				});
			});
		});
	}



	/**
	 * Get the user's options of Tabstree
	 * @param {string} name - The name of the option to retrieve
	 * @returns {string} The value of the option
	 * @throws {Error} The _name arg does not match any known option
	 */
	async function optionGet(_name) {
		const result = await chrome.storage.local.get(['options'])
		const options = result.options || {};
		
		switch (_name) {
		case 'defaulturl':
			return options.defaulturl || 'chrome://newtab';
			break;
		default:
			throw new Error("optionGet: _name unknown");
			break;
		}
	}

	/**
	 * Setup the Drag & Drop system on a tab
	 * @param {HTML element} _dragElem - HTML element to which drag should be applied
	 * @param {HTML element} _dropZoneSibling - HTML element to which drop should be applied
	 * @param {HTML element} _dropZoneChild - HTML element to which drop should be applied
	 */
	function initDragDrop(domFrag) {
		if (domFrag.root.classList.contains(`tab-item-pinned`)) return;
		initDrag(domFrag);
		initDrop(domFrag, true);
		initDrop(domFrag, false);
	}

	/**
	 * Setup the Drag system on a tab
	 * @param {HTML element} _dragElem - HTML element to which drag should be applied 
	 */
	function initDrag(domFrag) {
		domFrag.root.draggable = true;

		domFrag.root.addEventListener('dragstart', (e) => {
	        if (!e.ctrlKey) {
	            e.preventDefault();
	            return;
	        }

	        let siblingLevelMax = e.target.dataset.tabLevel;
			let targetSibling = e.target;
			let tabsCount = 0;
			do {
				++tabsCount;
				targetSibling.classList.add('manipulated');
				targetSibling = targetSibling.nextSibling;
			} while (targetSibling && targetSibling.dataset.tabLevel > siblingLevelMax);

			e.dataTransfer.setData('tabstree/tabs', JSON.stringify({tabId: e.target.dataset.tabId, tabsCount: tabsCount}));
			e.dataTransfer.setData('application/x-type-valid', 'true');
	    });

	    domFrag.root.addEventListener('dragend', (e) => {
	        let siblingLevelMax = e.target.dataset.tabLevel;
			let targetSibling = e.target;
			do {
				targetSibling.classList.remove('manipulated');
				targetSibling = targetSibling.nextSibling;
			} while (targetSibling && targetSibling.dataset.tabLevel > siblingLevelMax);
	    });
	}

	/**
	 * Setup the Drop system on a tab
	 * @param {HTML element} _dropZone - HTML element to which drop should be applied
	 */
	function initDrop(domFrag, sibling) {
		let dropZone = sibling ? domFrag.dropSibling : domFrag.dropChild;
		dropZone.addEventListener('dragover', (e) => {
			let targetSibling = document.querySelector('.tab-item-normal.manipulated');

 			// Same window
			if (targetSibling) {
				const currentTab = dropZone.closest('.tab-item-normal');
				const siblingLevelMax = targetSibling.dataset.tabLevel;
				do {
					if (targetSibling.dataset.tabId === currentTab.dataset.tabId) {
						return;
					}
					targetSibling = targetSibling.nextSibling;
				} while (targetSibling && targetSibling.dataset.tabLevel > siblingLevelMax);
			}

			e.preventDefault();
	        dropZone.classList.add('manipulated');
		});

		dropZone.addEventListener('dragleave', (e) => {
			dropZone.classList.remove('manipulated');
		});

		dropZone.addEventListener('drop', async (e) => {
			e.preventDefault();
		    dropZone.classList.remove('manipulated');

		    const rawPayload = JSON.parse(e.dataTransfer.getData('tabstree/tabs')) ;
		    const draggableElement = document.querySelector(`.tab-item-normal[data-tab-id="${rawPayload.tabId}"]`);
		    
			let wrongTarget = false; // Moving to self or children
			let arrTabsToRemoveDOM = [];

		    if (draggableElement) { // If not, it's from another window
			    let siblingLevelMax = draggableElement.dataset.tabLevel;
				let targetSibling = draggableElement;

				do {
					targetSibling.classList.remove('manipulated');

					if (e.target.closest('.tab-item-normal').dataset.tabId === targetSibling.dataset.tabId) {
						wrongTarget = true;
						break;
					}

					arrTabsToRemoveDOM.push(targetSibling);

					targetSibling = targetSibling.nextSibling;
				} while (targetSibling && targetSibling.dataset.tabLevel > siblingLevelMax);
			}

		    if (!wrongTarget) {
		        for (const tab of arrTabsToRemoveDOM)
					tab.remove();

				const tabIdMoving = parseInt(rawPayload.tabId);
				const tabIdTarget = parseInt(e.target.closest('.tab-item-normal').dataset.tabId);

				const tabMovingInfo = await queryTabInfo(tabIdMoving);
				const tabTargetInfo = await queryTabInfo(tabIdTarget);

				if (!tabMovingInfo
					|| !tabTargetInfo)
					return;

				windowIdOrig = tabMovingInfo.windowId;
				windowIdDest = tabTargetInfo.windowId;

				chrome.runtime.sendMessage({
					type: 'movetabs',
					payload: {
						windowIdOrig,
						windowIdDest,
						tabIdMoving,
						tabIdTarget,
						movingAbove: dropZone.classList.contains('drop-sibling') ? true : false,
						itemsNumber: rawPayload.tabsCount
					}
				});
		    }
		});
	}

	/**
	 * Create the Pointer Down event listener of a tab.
	 * Used for tab activation or swiping right
	 */
	function createTab_root_pointer_down(domFrag, domInfo) {
		return new Promise((resolve) => {
			domFrag.root.addEventListener('pointerdown', (e) => {
				// LMB : Select tab, start swipe
			    if (e.button === 0) {
					e.stopImmediatePropagation();
			    	contextMenu_hide();
			        domFrag.root.setPointerCapture(e.pointerId);
			        domInfo.isSwiping = !domInfo.isPinned ? true : false;
					domInfo.swipingCoordsOriX = e.clientX;
			    }
			});

		    resolve();
		});
	}

	/**
	 * Create the Pointer Move event listener of a tab.
	 * Used for swiping right.
	 */
	function createTab_root_pointer_move(domFrag, domInfo) {
		return new Promise((resolve) => {
			domFrag.root.addEventListener('pointermove', e => {
				// LMB : swipe
				if (domInfo.isSwiping && domFrag.root.hasPointerCapture(e.pointerId) && !e.ctrlKey) {
					e.stopImmediatePropagation();
					let transX = e.clientX - domInfo.swipingCoordsOriX;
					if (transX < 0) transX = .0;
					domFrag.root.style.translate = `${transX}px 0`;
					if (transX > 100) {
						domFrag.root.style.opacity = .25;
						domInfo.isClosing = true;
					}
					else {
						domFrag.root.style.opacity = 1;
						domInfo.isClosing = false;
					}
				}
			});

		    resolve();
		});
	}

	/**
	 * Create different types of Pointer Up event listener of a tab.
	 */
	async function createTab_root_pointer_up(domFrag, domInfo) {
		await Promise.all([
			createTab_root_pointer_dblclick(domFrag),
			createTab_root_pointer_up_lmb(domFrag, domInfo), // Swipe end
			createTab_root_pointer_up_mmb(domFrag, domInfo), // Close tab
			createTab_root_pointer_up_rmb(domFrag), // Display context menu
		]);
	}

	/**
	 * Create the Pointer Up event listener of a tab.
	 * Used to avoid tab creation when double cliking on a tab.
	 */
	function createTab_root_pointer_dblclick(domFrag) {
		return new Promise((resolve) => {
			domFrag.root.addEventListener('dblclick', e => {
				e.stopImmediatePropagation();
			});

		    resolve();
		});
	}

	/**
	 * Create the Pointer Up event listener of a tab.
	 * Used for the end of swiping right.
	 */
	function createTab_root_pointer_up_lmb(domFrag, domInfo) {
		return new Promise((resolve) => {
			domFrag.root.addEventListener('pointerup', async e => {
				if (e.button === 0
					&& domFrag.root.hasPointerCapture(e.pointerId)
					&& !e.target.closest('.context-menu-button')
					&& e.target.closest('.tab-item-pinned, .tab-item-normal')) {
					e.stopImmediatePropagation();
					domFrag.root.releasePointerCapture(e.pointerId);
					if (domInfo.isPinned
						|| domInfo.isSwiping) {
						domInfo.isSwiping = false;
						const tabId = parseInt(domFrag.root.dataset.tabId);

						if (!isNaN(tabId)) {
							if (domInfo.isPinned
								|| !domInfo.isClosing) {
								domFrag.root.style.opacity = 1.0;
								domFrag.root.style.translate = '0 0';

								chrome.tabs.update(tabId, { active: true }, (tab) => {
									if (chrome.runtime.lastError) {
										console.error('domFrag.root.addEventListener(pointerup):', chrome.runtime.lastError);
									}
								});
							} else {
								try {
									domFrag.root.setAttribute('inert', '');
									await chooseTabToActivate(tabId);
								    await chrome.tabs.remove(tabId);
								} catch (error) {
								    console.error('Erreur:', error);
								}
							}
						}
					}
				}

			}, { passive: false });

		    resolve();
		});
	}

	/**
	 * Create the Pointer Up event listener of a tab.
	 * Used to close a tab.
	 */
	function createTab_root_pointer_up_mmb(domFrag, domInfo) {
		return new Promise((resolve) => {
			domFrag.root.addEventListener('pointerup', async e => {
				if (e.button === 1
				&& !e.target.closest('.context-menu-button')
				&& e.target.closest('.tab-item-pinned, .tab-item-normal')) {
					e.stopImmediatePropagation();

					if (!domInfo.isPinned) {
						e.stopImmediatePropagation();
						try {
							const tabId = parseInt(domFrag.root.dataset.tabId);
							if (!isNaN(tabId)) {
								domFrag.root.setAttribute('inert', '');
								await chooseTabToActivate(tabId);
								await chrome.tabs.remove(tabId);
							}
						} catch (error) {
							console.error('domFrag.root.addEventListener(mouseup):', error);
						}
					}
				}
			}, { passive: false });

		    resolve();
		});
	}

	/**
	 * Create the Pointer Up event listener of a tab.
	 * Used to display the context menu.
	 */
	async function createTab_root_pointer_up_rmb(domFrag) {
		domFrag.root.addEventListener('pointerup', async event => {
			if (event.button === 2
				&& !event.target.closest('.context-menu-button')
				&& event.target.closest('.tab-item-pinned, .tab-item-normal')) {
				event.stopImmediatePropagation();

				contextMenu_hide();

				try {
					contextMenu_targetID = parseInt(event.currentTarget.closest('.tab-item-pinned, .tab-item-normal').dataset.tabId);
					const tabInfo = await queryTabInfo(contextMenu_targetID);

					await Promise.all([
						createTab_root_pointer_up_rmb_mute(tabInfo),
						createTab_root_pointer_up_rmb_pin(tabInfo),
						createTab_root_pointer_up_rmb_refresh(event),
						createTab_root_pointer_up_rmb_bookmark(tabInfo, event),
						createTab_root_pointer_up_rmb_hibernate(tabInfo),
						createTab_root_pointer_up_rmb_close(tabInfo, event),
						createTab_root_pointer_up_rmb_newtab(tabInfo, event)
					]);

					contextMenu_show(true, event);

					contextMenu_setPos(event);
				} catch (error) {
					console.error('createTab_root_pointer_up_rmb', error);
				}
			}
		}, { passive: false });
	}

	/**
	 * Modify the Mute button of the Right-click context menu in accordance with the properties of the tab targeted
	 */
	function createTab_root_pointer_up_rmb_mute(tabInfo) {
		return new Promise((resolve) => {
			if (tabInfo.mutedInfo?.muted ?? false)
				contCntxMenu_mute.src = chrome.runtime.getURL('images/icons/volume-high-solid-full.svg');					
			else
				contCntxMenu_mute.src = chrome.runtime.getURL('images/icons/volume-xmark-solid-full.svg');
			contCntxMenu_mute.title = (tabInfo.mutedInfo?.muted ?? false) ? chrome.i18n.getMessage('unmute') : chrome.i18n.getMessage('mute');
			
		    resolve();
		});
	}

	/**
	 * Modify the Pin button of the Right-click context menu in accordance with the properties of the tab targeted
	 */
	function createTab_root_pointer_up_rmb_pin(tabInfo) {
		return new Promise((resolve) => {
			contCntxMenu_pin.title = (tabInfo.pinned ?? false) ? chrome.i18n.getMessage('unpin') : chrome.i18n.getMessage('pin');

		    resolve();
		});
	}

	/**
	 * Modify the Refresh button of the Right-click context menu in accordance with the properties of the tab targeted
	 */
	function createTab_root_pointer_up_rmb_refresh(_event) {
		return new Promise((resolve) => {
			if (_event.ctrlKey) {
				contCntxMenu_refresh.classList.add('special');
				contCntxMenu_refresh.title = chrome.i18n.getMessage('refreshpurge');
			} else {
				contCntxMenu_refresh.classList.remove('special');
				contCntxMenu_refresh.title = chrome.i18n.getMessage('refresh');
			}

		    resolve();
		});
	}

	/**
	 * Modify the Bookmark button of the Right-click context menu in accordance with the properties of the tab targeted
	 */
	function createTab_root_pointer_up_rmb_bookmark(tabInfo, _event) {
		return new Promise((resolve) => {
			if (_event.ctrlKey
				&& !tabInfo.pinned) {
				contCntxMenu_bookmark.classList.add('special');
				contCntxMenu_bookmark.title = chrome.i18n.getMessage('bookmarkchildren');
			} else {
				contCntxMenu_bookmark.classList.remove('special');
				contCntxMenu_bookmark.title = chrome.i18n.getMessage('bookmark');
			}

		    resolve();
		});
	}

	/**
	 * Modify the Hibernate button of the Right-click context menu in accordance with the properties of the tab targeted
	 */
	function createTab_root_pointer_up_rmb_hibernate(tabInfo) {
		return new Promise((resolve) => {
			const isDiscardable = !tabInfo.active && !tabInfo.discarded && !tabInfo.frozen;
			if (!isDiscardable) {
				contCntxMenu_hibernate.setAttribute('inert', '');
			}
			else {
				contCntxMenu_hibernate.removeAttribute('inert');
			}

		    resolve();
		});
	}

	/**
	 * Modify the Close tab button of the Right-click context menu in accordance with the properties of the tab targeted
	 */
	function createTab_root_pointer_up_rmb_close(tabInfo, _event) {
		return new Promise((resolve) => {
			if (!tabInfo.pinned) {
				contCntxMenu_close.removeAttribute('inert');
				if (_event.ctrlKey) {
					contCntxMenu_close.classList.add('special');
					contCntxMenu_close.title = chrome.i18n.getMessage('closewithchildren');
				} else {
					contCntxMenu_close.classList.remove('special');
					contCntxMenu_close.title = chrome.i18n.getMessage('close');
				}
			} else {
				contCntxMenu_close.classList.remove('special');
				contCntxMenu_close.setAttribute('inert', '');
			}

		    resolve();
		});
	}

	/**
	 * Modify the New tab button of the Right-click context menu in accordance with the properties of the tab targeted
	 */
	function createTab_root_pointer_up_rmb_newtab(tabInfo, _event) {
		return new Promise((resolve) => {
			if (_event.ctrlKey
				&& !tabInfo.pinned) {
				contCntxMenu_newtab.classList.add('special');
				contCntxMenu_newtab.title = chrome.i18n.getMessage('newtabchild');
			} else {
				contCntxMenu_newtab.classList.remove('special');
				contCntxMenu_newtab.title = chrome.i18n.getMessage('newtab');
			}

		    resolve();
		});
	}

	/**
	 * Create the Drag & Drop feature of a tab
	 */
	function createTab_root_dragndrop(domFrag) {
		return new Promise((resolve) => {
			initDragDrop(domFrag);
		    resolve();
		});
	}

	/**
	 * Create the Status bar of a tab
	 */
	function createTab_root_status(domFrag, _tabInfo) {
		return new Promise((resolve) => {
			domFrag.status.classList.add('tab-item-status');
			if (_tabInfo.mutedInfo
				&& _tabInfo.mutedInfo.muted)
				domFrag.status.classList.add('muted');
			if (_tabInfo.audible)
				domFrag.status.classList.add('audible');
			/*if (_tabInfo.discarded
				|| _tabInfo.hibernate)
				domFrag.status.classList.add('hibernated');*/
			domFrag.status.addEventListener('pointerdown', async e => {
				e.stopImmediatePropagation();
				if (e.button === 0) {
					try {
						const tabId = parseInt(e.currentTarget.closest('.tab-item-pinned, .tab-item-normal').dataset.tabId);
						const _tabInfo = await chrome.tabs.get(tabId);
						const newMutedState = !_tabInfo.mutedInfo.muted;
						await chrome.tabs.update(tabId, { muted: newMutedState });
					} catch (error) {
						console.error('status.addEventListener(click):', error);
					}
				}
			}, { passive: false });
			domFrag.status.addEventListener('pointerup', async e => {
				e.stopImmediatePropagation();
			}, { passive: false });

		    resolve();
		});
	}

	/**
	 * Create the favicon skeleton of a tab
	 */
	function createTab_root_favicon(domFrag, _tabInfo) {
		return new Promise((resolve) => {
			domFrag.favicon.classList.add('tab-item-favicon');
			domFrag.favicon.crossOrigin = 'anonymous';
			domFrag.favicon.onerror = function() {
				this.onerror = function() {
				    this.src = chrome.runtime.getURL('images/blank-24.png');
				    this.classList.add('empty');
				    this.onerror = null;
				};
				
				this.src = `https://www.google.com/s2/favicons?domain=${this.src}&sz=24`;
				this.classList.remove('empty');
			};
		    domFrag.favicon.src = chrome.runtime.getURL('images/blank-24.png');
		    domFrag.favicon.classList.add('empty');

			if (_tabInfo.favIconUrl
				&& _tabInfo.favIconUrl !== '') {
				domFrag.favicon.src = _tabInfo.favIconUrl;
				domFrag.favicon.classList.remove('empty');
			}
			else if (_tabInfo.url || _tabInfo.pendingUrl) {
				const ret = faviconFromUrl(_tabInfo.url || _tabInfo.pendingUrl);

				if (ret.knownType === true) {
					domFrag.favicon.src = ret.src;
					domFrag.favicon.classList.remove('empty');
				}
			}

		    resolve();
		});
	}

	/**
	 * Create the title of a tab
	 */
	function createTab_root_title(domFrag, _tabInfo, _type) {
		return new Promise((resolve) => {
			if (_type === 'normal') {
				domFrag.title.classList.add('tab-item-title');
				domFrag.title.innerHTML = _tabInfo.title;
			}

		    resolve();
		});
	}

	/**
	 * Create a new tab and push it into the DOM
	 * @param {Map<number, number||null>} _tabstruct - Map of tabs hierarchy for the current windowId
	 * @param {Promise<Tab>} _tabInfo - Properties of the tab
	 * @param {number} _tabElem - ID of the tab
	 * @param {HTML element} _container - HTML pinned or normal tabs container
	 * @param {string} _type - Is the tab pinned or normal
	 */
	async function createTab(_tabstruct, _tabInfo, _tabElem, _container, _type) {
		try {
			const tabIdInt = typeof _tabElem === String ? parseInt(_tabElem) : _tabElem;
			const tabIndex = Array.from(_tabstruct.keys()).indexOf(tabIdInt);
			const tabIdBefore = Array.from(_tabstruct.keys())[tabIndex - 1] ?? null;
			const tabBeforeInfo = tabIdBefore !== null ? await queryTabInfo(tabIdBefore) : null;
			const tabLevel = tabLevelCalc(_tabstruct, tabIdInt);
			/*
			let isSwiping = false;
			let isPinned = _tabInfo.pinned;
			let isClosing = false;
			let swipingCoordsOriX = .0;
			*/

			const domFrag = {
				root: document.createElement('div'),
				dropSibling: document.createElement('div'),
				dropChild: document.createElement('div'),
				status: document.createElement('div'),
				favicon: document.createElement('img'),
				title: document.createElement('div')
			};

			const domInfo = {
				isSwiping: false,
				isPinned: _tabInfo.pinned,
				isClosing: false,
				swipingCoordsOriX: .0
			};

			domFrag.root.classList.add(`tab-item-${_type}`);
			domFrag.root.dataset.tabId = tabIdInt;
			domFrag.root.dataset.tabLevel = tabLevel;
			domFrag.root.title = _tabInfo.title;

			domFrag.dropSibling.classList.add('drop-sibling');
			domFrag.dropChild.classList.add('drop-child');

			await Promise.all([
				createTab_root_pointer_down(domFrag, domInfo),
				createTab_root_pointer_move(domFrag, domInfo),
				createTab_root_pointer_up(domFrag, domInfo),
				createTab_root_dragndrop(domFrag),
				createTab_root_status(domFrag, _tabInfo),
				createTab_root_favicon(domFrag, _tabInfo),
				createTab_root_title(domFrag, _tabInfo, _type)
			]);

			domFrag.root.append(domFrag.dropChild);
			domFrag.root.append(domFrag.dropSibling);
			domFrag.root.append(domFrag.status);
			domFrag.root.append(domFrag.favicon);
			domFrag.root.append(domFrag.title);

			// The new tab has the position 0
			if (tabIndex === 0
				|| (!domInfo.isPinned && tabBeforeInfo !== null && tabBeforeInfo.pinned)) {
				_container.prepend(domFrag.root);
			}
			// The new tab has a sibling before
			else if (tabIdBefore
				&& _container.querySelector(`[data-tab-id="${tabIdBefore}"]`)?.nextSibling){
				_container.insertBefore(domFrag.root, _container.querySelector(`[data-tab-id="${tabIdBefore}"]`).nextSibling);
			}
			// The new tab is alone in the container
			else
				_container.append(domFrag.root);

			return domFrag.root;
		} catch (error) {
			//TRACE();
			//chrome.notifications.create({
		    //  type: 'basic',
		    //  iconUrl: 'images/icon-64.png',
		    //  title: 'ERROR',
		    //  message: 'Error detected!'
		    //});
			console.error('createTab', error);
			return null;
		}
	}


	/**
	 * The window lose the focus on the DOM
	 */
	window.addEventListener('blur', e => {
		contextMenu_hide();
	});

	/**
	 * A key of the keyboard is released on the DOM
	 */
	document.addEventListener('keyup', e => {
		if (e.key === 'Escape')
			contextMenu_hide();
	});

	/**
	 * A mouse button is released on the DOM
	 */
	document.addEventListener('pointerup', e => {
		// LMB: Right-click context menu has to be hidden
		if (e.button === 0) {
			contextMenu_hide();
		}
		// RMB: Right-click context menu has to be shown
		else if (e.button === 2) {
			e.stopImmediatePropagation();
			contextMenu_hide();
			contextMenu_setPos(e);
			contextMenu_show(false);
		}
	});

	/**
	 * A request (RMB) has been made for the context menu to open on the DOM
	 */
	document.addEventListener('contextmenu', e => {
		//return; // DEBUG
		// Hide the browser built-in Right-click context menu
		e.preventDefault();
	});

	/**
	 * Double LMB click on the DOM
	 */
	document.addEventListener('dblclick', async e => {
		e.stopImmediatePropagation();
		await chrome.tabs.create({
			active: true,
			url: await optionGet("defaulturl")
		});
	});

	/**
	 * Mouse wheel on the DOM
	 */
	document.addEventListener('wheel', async (e) => {
		try {
			await mutexDOM.runExclusive(async () => {
				if (Math.abs(e.deltaY) > 0) {
					const [tabActiveInfos] = await chrome.tabs.query({
						active: true,
					    currentWindow: true
					});

					if (tabActiveInfos) {
						const tabstruct = await tabstructGet();
						const targetIndex = Array.from(tabstruct.keys()).indexOf(tabActiveInfos.id);

						if (targetIndex !== -1) {
							if (e.deltaY > 0) {
								chosenKey = targetIndex < tabstruct.size - 1 ? Array.from(tabstruct.keys())[targetIndex + 1] : Array.from(tabstruct.keys())[0];
							}
							else if (e.deltaY < 0) {
								chosenKey = targetIndex > 0 ? Array.from(tabstruct.keys())[targetIndex - 1] : Array.from(tabstruct.keys())[tabstruct.size - 1];
							}

							chrome.tabs.update(chosenKey, { active: true }, (tab) => {
								if (chrome.runtime.lastError) {
									console.error('document.addEventListener(wheel) #1:', chrome.runtime.lastError);
								}
							});
						}
					}
				}
			});
		} catch (error) {
			console.error('document.addEventListener(wheel) #2:', error);
		}
	}, { passive: false });



	/**
	 * Trigger clicks on the Tabstree's Right-click context menu
	 * in order to avoid click event propagation to others elements
	 * @param {event} e - Description
	 */
	contCntxMenu.addEventListener('pointerdown', (e) => {
		e.stopImmediatePropagation();
	}, { passive: false });
	contCntxMenu.addEventListener('pointerup', (e) => {
		e.stopImmediatePropagation();
	}, { passive: false });



	/**
	 * A tab has its property modified
	 * @param {number} tabId
	 * @param {object} changeInfo
	 * @param {Tab} tab
	 */
	chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
		await mutexDOM.runExclusive(async () => {
			if (tab.windowId === myWindowId) {
				onUpdated(tabId, changeInfo, tab);
			}
		});
	});

	/**
	 * A tab has been selected
	 * @param {object} activeInfo
	 */
	chrome.tabs.onActivated.addListener(async (activeInfo) => {
		await mutexDOM.runExclusive(async () => {
			if (activeInfo.windowId === myWindowId) {
				// Process tab
				const arrTabsDOM = document.querySelectorAll('.tab-item-pinned, .tab-item-normal');
				arrTabsDOM.forEach(tabDOM => {
					tabDOM.classList.remove('active');
				});

				const tabElem = document.querySelector(`.tab-item-pinned[data-tab-id="${activeInfo.tabId}"], .tab-item-normal[data-tab-id="${activeInfo.tabId}"]`);
				if (tabElem) {
					tabElem.classList.add('active');

					// Set position of the scrollbar
					tabElem.scrollIntoView({
						behavior: 'smooth',
						block: 'nearest',
						inline: 'nearest'
					});	
				}
			}

			requestAnimationFrame(() => {
				null;
			});
		});
	});

	/**
	 * Description
	 * @param {number} _tabId
	 * @param {object} _removeInfo
	 */
	chrome.tabs.onRemoved.addListener(async (_tabId, _removeInfo) => {
		await chooseTabToActivate(_tabId, true);
	});



	/**
	 * Dispatch received messages from background.js
	 * @param {any} message
	 * @param {MessageSender} sender
	 * @param {function} sendResponse
	 */
	chrome.runtime.onMessage.addListener(async (message, sender, sendResponse) => {
		if (message.action === 'onCreated'
			&& message.data.windowId == myWindowId) {
			const tabstruct = await tabstructGet();
			await onCreated(message.data.tab, tabstruct);
		}
		else if (message.action === 'onRemoved'
			&& message.data.windowId == myWindowId) {
			const tabstruct = await tabstructGet();
			await onRemoved(message.data.tabId, tabstruct);
		}
		else if (message.action === 'onReplaced'
			&& message.data.windowId == myWindowId) {
			await onReplaced(message.data.addedTabId, message.data.removedTabId);
		}
		else if (message.action === 'syncTabsList'
			&& message.data.windowId == myWindowId) {
			await syncTabsList();
		}
	});



	/**
	 * Early interception of navigations is available
	 */
	if (chrome.webNavigation) {
		/**
		 * Triggered before navigation starts
		 * @param {object} details - Navigation details
		 */
		await chrome.webNavigation.onBeforeNavigate.addListener(async (details) => {
			if (details.frameId === 0) {
				await mutexDOM.runExclusive(async () => {
					const tabDOM = document.querySelector(`.tab-item-normal[data-tab-id="${details.tabId}"], .tab-item-pinned[data-tab-id="${details.tabId}"]`);
					if (tabDOM)
						tabDOM.style.setProperty('--progress', '0%');
				});
			}
		});

		/**
		 * Triggered when the URL is confirmed, no cancel
		 * @param {object} details - Navigation details
		 */
		await chrome.webNavigation.onCommitted.addListener(async (details) => {
			if (details.frameId === 0) {
				await mutexDOM.runExclusive(async () => {
					const tabDOM = document.querySelector(`.tab-item-normal[data-tab-id="${details.tabId}"], .tab-item-pinned[data-tab-id="${details.tabId}"]`);
					if (tabDOM)
						tabDOM.style.setProperty('--progress', '10%');
				});
			}
		});
		
		/**
		 * Triggered when the server response begins
		 * @param {object} details - Navigation details
		 */
		await chrome.webNavigation.onResponseStarted?.addListener(async (details) => {
			if (details.frameId === 0) {
				await mutexDOM.runExclusive(async () => {
					const tabDOM = document.querySelector(`.tab-item-normal[data-tab-id="${details.tabId}"], .tab-item-pinned[data-tab-id="${details.tabId}"]`);
					if (tabDOM)
						tabDOM.style.setProperty('--progress', '30%');
				});
			}
		});
		
		/**
		 * Triggered when the HTTP headers are parsed
		 * @param {object} details - Navigation details
		 */
		await chrome.webNavigation.onHeadersReceived?.addListener(async (details) => {
			if (details.frameId === 0) {
				await mutexDOM.runExclusive(async () => {
					const tabDOM = document.querySelector(`.tab-item-normal[data-tab-id="${details.tabId}"], .tab-item-pinned[data-tab-id="${details.tabId}"]`);
					if (tabDOM)
						tabDOM.style.setProperty('--progress', '45%');
				});
			}
		});
		
		/**
		 * Triggered when DOM is parsed, no subresources
		 * @param {object} details - Navigation details
		 */
		await chrome.webNavigation.onDOMContentLoaded.addListener(async (details) => {
			if (details.frameId === 0) {
				await mutexDOM.runExclusive(async () => {
					const tabDOM = document.querySelector(`.tab-item-normal[data-tab-id="${details.tabId}"], .tab-item-pinned[data-tab-id="${details.tabId}"]`);
					if (tabDOM)
						tabDOM.style.setProperty('--progress', '70%');
				});
			}
		});
		
		/**
		 * Triggered when all the resources are loaded
		 * @param {object} details - Navigation details
		 */
		await chrome.webNavigation.onCompleted.addListener(async (details) => {
			if (details.frameId === 0) {
				await mutexDOM.runExclusive(async () => {
					const tabDOM = document.querySelector(`.tab-item-normal[data-tab-id="${details.tabId}"], .tab-item-pinned[data-tab-id="${details.tabId}"]`);
					if (tabDOM)
						tabDOM.style.setProperty('--progress', '100%');
				});
			}
		});
		
		/**
		 * Triggered if any failure point
		 * @param {object} details - Navigation details
		 */
		await chrome.webNavigation.onErrorOccurred.addListener(async (details) => {
			if (details.frameId === 0) {
				await mutexDOM.runExclusive(async () => {
					const tabDOM = document.querySelector(`.tab-item-normal[data-tab-id="${details.tabId}"], .tab-item-pinned[data-tab-id="${details.tabId}"]`);
					if (tabDOM)
						tabDOM.style.setProperty('--progress', '100%');
				});
			}
		});
	}



	/**
	 * Script start
	 */
	try {
		const win = await chrome.windows.getCurrent();
		if (win) {
			myWindowId = win.id;
		}
	} catch (error) {
		console.error("Cannot get current window ID", error);
	}

	createContextMenu();
	syncTabsList();
});