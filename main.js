import { Buffer } from "buffer";
window.Buffer = window.Buffer || Buffer;

import { ethers } from "ethers";
import { Seaport } from "@opensea/seaport-js";

// ==========================================
// 1. KONFIQURASIYA VƏ SABİTLƏR
// ==========================================

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || "https://azekamo100.onrender.com";
const NFT_CONTRACT_ADDRESS = import.meta.env.VITE_NFT_CONTRACT || "0x54a88333F6e7540eA982261301309048aC431eD5";
const SEAPORT_CONTRACT_ADDRESS = "0x0000000000000068F116a894984e2DB1123eB395";

const ZERO_BYTES32 = "0x0000000000000000000000000000000000000000000000000000000000000000";
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

const APECHAIN_ID = 33139;
const APECHAIN_ID_HEX = "0x8173";

let provider = null;
let signer = null;
let seaport = null;
let userAddress = null;

let selectedTokens = new Set();

// UI Elementləri
const connectBtn = document.getElementById("connectBtn");
const disconnectBtn = document.getElementById("disconnectBtn");
const addrSpan = document.getElementById("addr");
const marketplaceDiv = document.getElementById("marketplace");
const noticeDiv = document.getElementById("notice");
const bulkBar = document.getElementById("bulkBar");
const bulkCount = document.getElementById("bulkCount");
const bulkPriceInp = document.getElementById("bulkPrice");
const bulkListBtn = document.getElementById("bulkListBtn");

// ==========================================
// 2. KÖMƏKÇİ FUNKSİYALAR (HELPERS)
// ==========================================

function notify(msg, timeout = 3000) {
  if (!noticeDiv) return;
  noticeDiv.textContent = msg;
  console.log(`[NOTIFY]: ${msg}`);
  if (timeout) setTimeout(() => { if (noticeDiv.textContent === msg) noticeDiv.textContent = ""; }, timeout);
}

function resolveIPFS(url) {
  if (!url) return "https://i.postimg.cc/Hng3NRg7/Steptract-Logo.png";
  const GATEWAY = "https://cloudflare-ipfs.com/ipfs/";
  let originalUrl = url;
  if (url.startsWith("ipfs://")) {
    originalUrl = url.replace("ipfs://", GATEWAY);
  } else if (url.startsWith("Qm") && url.length >= 46) {
    originalUrl = `${GATEWAY}${url}`;
  }
  return `https://wsrv.nl/?url=${encodeURIComponent(originalUrl)}&w=500&q=75&output=webp&il`;
}

// ------------------------------------------
// CRITICAL FIX: CLEAN ORDER FUNCTION
// ------------------------------------------
function cleanOrder(orderData) {
  try {
    // DB-dən gələn məlumat bəzən birbaşa object, bəzən {order: ...} içində olur
    const order = orderData.order || orderData;
    const { parameters, signature } = order;

    if (!parameters) {
        console.error("Order parameters not found:", orderData);
        return null;
    }

    // Helper: Dəyərləri etibarlı string-ə çevirir
    const toStr = (val) => {
        if (val === undefined || val === null) return "0";
        if (typeof val === "object" && val.hex) return BigInt(val.hex).toString();
        if (ethers.BigNumber.isBigNumber(val)) return val.toString();
        return String(val);
    };

    return {
      parameters: {
        offerer: parameters.offerer,
        zone: parameters.zone || ZERO_ADDRESS,
        offer: parameters.offer.map(item => ({
          itemType: Number(item.itemType), 
          token: item.token,
          identifierOrCriteria: toStr(item.identifierOrCriteria || item.identifier),
          startAmount: toStr(item.startAmount),
          endAmount: toStr(item.endAmount)
        })),
        consideration: parameters.consideration.map(item => ({
          itemType: Number(item.itemType), 
          token: item.token,
          identifierOrCriteria: toStr(item.identifierOrCriteria || item.identifier),
          startAmount: toStr(item.startAmount),
          endAmount: toStr(item.endAmount),
          recipient: item.recipient
        })),
        orderType: Number(parameters.orderType), 
        startTime: toStr(parameters.startTime),
        endTime: toStr(parameters.endTime),
        // Fix: zoneHash və conduitKey mütləq olmalıdır
        zoneHash: parameters.zoneHash || ZERO_BYTES32,
        salt: toStr(parameters.salt),
        conduitKey: parameters.conduitKey || ZERO_BYTES32,
        counter: toStr(parameters.counter),
        totalOriginalConsiderationItems: Number(
            parameters.totalOriginalConsiderationItems !== undefined 
            ? parameters.totalOriginalConsiderationItems 
            : parameters.consideration.length
        )
      },
      signature: signature
    };
  } catch (e) { 
      console.error("CleanOrder Error:", e);
      return null; 
  }
}

// Orderi DB-yə yazarkən sadələşdirmək üçün
function orderToJsonSafe(obj) {
  return JSON.parse(JSON.stringify(obj, (k, v) => {
    if (v && typeof v === "object") {
      if (ethers.BigNumber.isBigNumber(v)) return v.toString();
      if (v._hex) return ethers.BigNumber.from(v._hex).toString();
    }
    return v;
  }));
}

// ==========================================
// 3. CÜZDAN QOŞULMASI (WALLET CONNECT)
// ==========================================

async function connectWallet() {
  try {
    if (!window.ethereum) return alert("Metamask tapılmadı!");
    provider = new ethers.providers.Web3Provider(window.ethereum, "any");
    await provider.send("eth_requestAccounts", []);
    const network = await provider.getNetwork();

    if (network.chainId !== APECHAIN_ID) {
      try {
        await window.ethereum.request({
          method: "wallet_addEthereumChain",
          params: [{
            chainId: APECHAIN_ID_HEX,
            chainName: "ApeChain Mainnet",
            nativeCurrency: { name: "APE", symbol: "APE", decimals: 18 },
            rpcUrls: [import.meta.env.VITE_APECHAIN_RPC || "https://rpc.apechain.com"],
            blockExplorerUrls: ["https://apescan.io"],
          }],
        });
        provider = new ethers.providers.Web3Provider(window.ethereum, "any");
      } catch (e) { return alert("ApeChain şəbəkəsinə keçilmədi."); }
    }

    signer = provider.getSigner();
    userAddress = (await signer.getAddress()).toLowerCase();
    
    // Seaport konfiqurasiyası
    seaport = new Seaport(signer, { 
        overrides: { contractAddress: SEAPORT_CONTRACT_ADDRESS } 
    });
    
    connectBtn.style.display = "none";
    disconnectBtn.style.display = "inline-block";
    addrSpan.textContent = `Wallet: ${userAddress.slice(0, 6)}...${userAddress.slice(-4)}`;
    notify("Cüzdan qoşuldu!");
    
    // Hesab dəyişəndə səhifəni yenilə
    window.ethereum.on("accountsChanged", () => location.reload());

    await loadNFTs();
  } catch (err) { alert("Connect xətası: " + err.message); }
}

disconnectBtn.onclick = () => {
  provider = signer = seaport = userAddress = null;
  connectBtn.style.display = "inline-block";
  disconnectBtn.style.display = "none";
  addrSpan.textContent = "";
  marketplaceDiv.innerHTML = "";
  notify("Çıxış edildi");
};

connectBtn.onclick = connectWallet;

// ==========================================
// 4. NFT YÜKLƏMƏ VƏ RENDER (LOAD NFTs)
// ==========================================

let loadingNFTs = false;
let allNFTs = [];

async function loadNFTs() {
  if (loadingNFTs) return;
  loadingNFTs = true;
  marketplaceDiv.innerHTML = "<p style='color:black; width:100%; text-align:center;'>NFT-lər yüklənir...</p>";
  
  selectedTokens.clear();
  updateBulkUI();

  try {
    const res = await fetch(`${BACKEND_URL}/api/nfts`);
    const data = await res.json();
    allNFTs = data.nfts || [];
    marketplaceDiv.innerHTML = "";

    if (allNFTs.length === 0) {
      marketplaceDiv.innerHTML = "<p style='color:black; width:100%; text-align:center;'>Hələ NFT yoxdur.</p>";
      return;
    }

    // Owner check üçün read-only contract
    let nftContractRead = null;
    if (provider) {
       nftContractRead = new ethers.Contract(NFT_CONTRACT_ADDRESS, ["function ownerOf(uint256) view returns (address)"], provider);
    }

    for (const nft of allNFTs) {
      const tokenidRaw = (nft.tokenid !== undefined && nft.tokenid !== null) ? nft.tokenid : nft.tokenId;
      
      if (tokenidRaw === undefined || tokenidRaw === null) continue;
      const tokenid = tokenidRaw.toString(); 

      const name = nft.name || `NFT #${tokenid}`;
      const image = resolveIPFS(nft.image);
      
      let displayPrice = "";
      let priceVal = 0;
      let isListed = false;

      // Qiymət yoxlanışı
      if (nft.price && parseFloat(nft.price) > 0) {
        priceVal = parseFloat(nft.price);
        displayPrice = `${priceVal} APE`;
        isListed = true;
      }

      // Real sahibi yoxla
      let realOwner = null;
      if (nftContractRead) {
          try { realOwner = await nftContractRead.ownerOf(tokenid); } catch(e) {}
      }

      // Əgər cüzdan qoşulubsa: 
      // isMine = Mənim cüzdanım real sahibdir
      // isSeller = Mənim cüzdanım bazada satıcı kimi qeyd olunub
      const isMine = (userAddress && realOwner && userAddress.toLowerCase() === realOwner.toLowerCase());
      const isSeller = (userAddress && nft.seller_address && userAddress.toLowerCase() === nft.seller_address.toLowerCase());
      
      // İdarə edə bilərəm, əgər sahibiyəmsə və ya satıcıyamsa
      const canManage = isMine || (isSeller && isListed);

      const card = document.createElement("div");
      card.className = "nft-card";
      
      let checkboxHTML = "";
      if (canManage) {
          checkboxHTML = `<input type="checkbox" class="select-box" data-id="${tokenid}">`;
      }

      let actionsHTML = "";
      if (isListed) {
          if (canManage) {
              actionsHTML = `
                <input type="number" placeholder="Update Price" class="mini-input price-input" step="0.001">
                <button class="action-btn btn-list update-btn">Update</button>
              `;
          } else {
              actionsHTML = `<button class="action-btn btn-buy buy-btn">Buy</button>`;
          }
      } else {
          if (canManage) {
              displayPrice = ""; 
              actionsHTML = `
                 <input type="number" placeholder="Price" class="mini-input price-input" step="0.001">
                 <button class="action-btn btn-list list-btn">List</button>
              `;
          }
      }

      card.innerHTML = `
        ${checkboxHTML}
        <div class="card-image-wrapper">
            <img src="${image}" loading="lazy" decoding="async" onerror="this.src='https://i.postimg.cc/Hng3NRg7/Steptract-Logo.png'">
        </div>
        <div class="card-content">
            <div class="card-title">${name}</div>
            <div class="card-details">
                 ${displayPrice ? `<div class="price-val">${displayPrice}</div>` : `<div style="height:24px"></div>`}
            </div>
            <div class="card-actions">
                ${actionsHTML}
            </div>
        </div>
      `;
      marketplaceDiv.appendChild(card);

      // Checkbox event
      const chk = card.querySelector(".select-box");
      if (chk) {
          chk.onchange = (e) => {
              if (e.target.checked) selectedTokens.add(tokenid);
              else selectedTokens.delete(tokenid);
              updateBulkUI();
          };
      }

      // Button Events
      if (actionsHTML !== "") {
          const priceInput = card.querySelector(".price-input");
          
          if (isListed) {
              if (canManage) {
                 const btn = card.querySelector(".update-btn");
                 if(btn) btn.onclick = async () => {
                     let inp = priceInput.value;
                     if(inp) inp = inp.trim();
                     if(!inp || isNaN(inp) || parseFloat(inp) <= 0) return notify("Düzgün qiymət yazın!");
                     await listNFT(tokenid, inp);
                 };
              } else {
                 const btn = card.querySelector(".buy-btn");
                 if(btn) btn.onclick = async () => await buyNFT(nft);
              }
          } else if (canManage) {
              const btn = card.querySelector(".list-btn");
              if(btn) btn.onclick = async () => {
                 let inp = priceInput.value;
                 if(inp) inp = inp.trim();
                 if(!inp || isNaN(inp) || parseFloat(inp) <= 0) return notify("Düzgün qiymət yazın!");
                 await listNFT(tokenid, inp);
              };
          }
      }
    }
  } catch (err) {
    console.error(err);
    marketplaceDiv.innerHTML = "<p style='color:red; text-align:center;'>Yüklənmə xətası.</p>";
  } finally {
    loadingNFTs = false;
  }
}

// ==========================================
// 5. BULK UI (TOPLU SEÇİM)
// ==========================================

function updateBulkUI() {
    if (selectedTokens.size > 0) {
        bulkBar.classList.add("active");
        bulkCount.textContent = `${selectedTokens.size} NFT seçildi`;
    } else {
        bulkBar.classList.remove("active");
    }
}

window.cancelBulk = () => {
    selectedTokens.clear();
    document.querySelectorAll(".select-box").forEach(b => b.checked = false);
    updateBulkUI();
};

if(bulkListBtn) {
    bulkListBtn.onclick = async () => {
        let priceVal = bulkPriceInp.value;
        if(priceVal) priceVal = priceVal.trim();
        if (!priceVal || isNaN(priceVal) || parseFloat(priceVal) <= 0) return alert("Toplu satış üçün düzgün qiymət yazın.");
        const tokensArray = Array.from(selectedTokens);
        await bulkListNFTs(tokensArray, priceVal);
    };
}

// ==========================================
// 6. LISTING (SATIŞA ÇIXARMAQ)
// ==========================================

async function listNFT(tokenid, priceInEth) {
  if (tokenid === undefined || tokenid === null) {
      alert("XƏTA: Token ID təyin edilməyib. Səhifəni yeniləyin.");
      return;
  }
  await bulkListNFTs([tokenid], priceInEth);
}

async function bulkListNFTs(tokenIds, priceInEth) {
    console.log("List Start:", { tokenIds, priceInEth });

    if (!signer || !seaport) return alert("Cüzdan qoşulmayıb!");
    
    // 1. Validasiya
    if (!priceInEth || String(priceInEth).trim() === "") return alert("Qiymət boşdur.");

    let priceWeiString;
    try {
        const safePrice = String(priceInEth).trim();
        const priceBig = ethers.utils.parseEther(safePrice); 
        priceWeiString = priceBig.toString();
    } catch (e) {
        return alert(`Qiymət xətası: ${e.message}`);
    }

    const cleanTokenIds = tokenIds.map(t => String(t));
    const seller = await signer.getAddress();

    // 2. Təsdiq (Approve) - Yalnız bir dəfə lazımdır
    try {
        const nftContract = new ethers.Contract(NFT_CONTRACT_ADDRESS, 
            ["function isApprovedForAll(address,address) view returns(bool)", "function setApprovalForAll(address,bool)"], signer);
        
        const isApproved = await nftContract.isApprovedForAll(seller, SEAPORT_CONTRACT_ADDRESS);
        if (!isApproved) {
            notify("Satış kontraktı təsdiq olunur...");
            const tx = await nftContract.setApprovalForAll(SEAPORT_CONTRACT_ADDRESS, true);
            await tx.wait();
            notify("Təsdiqləndi!");
        }
    } catch (e) { return alert("Approve xətası: " + e.message); }

    notify(`${cleanTokenIds.length} NFT orderi imzalanır...`);

    try {
        // StartTime 5 dəqiqə geriyə çəkilir ki, blokçeyn vaxt xətası verməsin
        const startTimeVal = (Math.floor(Date.now()/1000) - 300).toString();
        const endTimeVal = (Math.floor(Date.now()/1000) + 2592000).toString(); // 30 gün

        const orderInputs = cleanTokenIds.map(tokenStr => {
            return {
                conduitKey: ZERO_BYTES32, // ConduitKey 0 olmalıdır
                offer: [{ 
                    itemType: 2, // ERC721
                    token: NFT_CONTRACT_ADDRESS, 
                    identifier: tokenStr,
                    amount: "1"
                }],
                consideration: [{ 
                    itemType: 0, // NATIVE (APE)
                    token: ZERO_ADDRESS, 
                    identifier: "0", 
                    amount: priceWeiString, 
                    recipient: seller 
                }],
                startTime: startTimeVal,
                endTime: endTimeVal,
            };
        });

        notify("Zəhmət olmasa cüzdanda imzalayın...");
        
        // Seaport Bulk Order yaradır
        const { executeAllActions } = await seaport.createBulkOrders(orderInputs, seller);
        const signedOrders = await executeAllActions(); 

        notify("İmza alındı! Bazaya yazılır...");

        // Uğurlu orderləri DB-yə göndər
        let successCount = 0;
        for (const order of signedOrders) {
            const offerItem = order.parameters.offer[0];
            const tokenStr = offerItem.identifierOrCriteria;

            // Bazaya yazanda formatı təmizlə
            const plainOrder = orderToJsonSafe(order);
            const orderHash = seaport.getOrderHash(order.parameters);

            await fetch(`${BACKEND_URL}/api/order`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    tokenid: tokenStr,
                    price: String(priceInEth),
                    seller_address: seller,
                    seaport_order: plainOrder,
                    order_hash: orderHash,
                    status: "active"
                }),
            });
            successCount++;
        }

        notify(`Tamamlandı! ${successCount} NFT satışa çıxdı.`);
        setTimeout(() => location.reload(), 1500);

    } catch (err) {
        console.error("List Error:", err);
        alert("Satış xətası: " + (err.message || err));
    }
}

// ==========================================
// 7. BUY FUNCTION (ALMAQ) - FULL FIX
// ==========================================

async function buyNFT(nftRecord) {
    if (!signer || !seaport) return alert("Cüzdan qoşulmayıb!");
    
    try {
        const buyerAddress = await signer.getAddress();
        
        // 1. Sahiblik yoxlanışı
        const nftContract = new ethers.Contract(NFT_CONTRACT_ADDRESS, ["function ownerOf(uint256) view returns (address)"], provider);
        try {
            const owner = await nftContract.ownerOf(nftRecord.tokenid);
            if (owner.toLowerCase() === buyerAddress.toLowerCase()) return alert("Bu NFT artıq sizindir!");
        } catch(e) {}

        notify("Order hazırlanır...");
        
        // 2. JSON Parse və Təmizləmə
        let rawJson = nftRecord.seaport_order;
        if (typeof rawJson === "string") { 
            try { rawJson = JSON.parse(rawJson); } catch (e) { return alert("JSON Parse Xətası"); } 
        }

        const cleanOrd = cleanOrder(rawJson);
        if (!cleanOrd) return alert("Order strukturu xətalıdır");

        // 3. Seaport Fulfillment
        // ConduitKey parametrini mütləq ötürmək lazımdır
        const { actions } = await seaport.fulfillOrder({ 
            order: cleanOrd, 
            accountAddress: buyerAddress,
            conduitKey: cleanOrd.parameters.conduitKey 
        });

        const txRequest = await actions[0].transactionMethods.buildTransaction();

        // 4. Value Hesablanması (Seaport bəzən 0 qaytarır, əl ilə yoxlayırıq)
        let finalValue = txRequest.value ? ethers.BigNumber.from(txRequest.value) : ethers.BigNumber.from(0);

        if (finalValue.eq(0) && cleanOrd.parameters.consideration) {
            cleanOrd.parameters.consideration.forEach(c => {
                if (Number(c.itemType) === 0) { 
                     finalValue = finalValue.add(ethers.BigNumber.from(c.startAmount));
                }
            });
        }

        notify("Metamask açılır...");
        
        // 5. Tranzaksiyanı göndərmək
        // Gas Limit-i manual qoymuruq, "estimateGas" xəta versə, deməli order səhvdir
        // Lakin, "Revert" səbəbini görmək üçün try-catch əlavə edirik
        let tx;
        try {
             tx = await signer.sendTransaction({
                to: txRequest.to,
                data: txRequest.data,
                value: finalValue
                // gasLimit qoymuruq, auto-calculate olsun
            });
        } catch (gasError) {
            // Əgər estimateGas xəta versə, fallback edirik amma risklidir
            console.warn("Gas estimate failed:", gasError);
            if(confirm("Gas hesablanmadı (ehtimal ki, xəta var). Yenə də məcbur göndərmək istəyirsiniz?")) {
                tx = await signer.sendTransaction({
                    to: txRequest.to,
                    data: txRequest.data,
                    value: finalValue,
                    gasLimit: ethers.BigNumber.from("500000")
                });
            } else {
                throw new Error("Tranzaksiya Gas a görə ləğv edildi (Gas Estimate Failed).");
            }
        }

        notify("Blokchaində təsdiqlənir...");
        await tx.wait();
        notify("Uğurlu alış!");

        // Bazada satışı qeyd et
        await fetch(`${BACKEND_URL}/api/buy`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ 
                tokenid: nftRecord.tokenid, 
                order_hash: nftRecord.order_hash, 
                buyer_address: buyerAddress 
            }),
        });
        setTimeout(() => location.reload(), 2000);

    } catch (err) {
        console.error("Buy Error Details:", err);
        let msg = err.message || err;
        
        if (msg.includes("insufficient funds")) msg = "Balansınız kifayət etmir.";
        else if (msg.includes("user rejected")) msg = "İmtina edildi.";
        else if (msg.includes("CALL_EXCEPTION") || msg.includes("UNPREDICTABLE_GAS_LIMIT")) {
            msg = "Tranzaksiya alınmadı.";
        }
        
        alert("Buy Xətası: " + msg);
    }
}

// Global scope
window.loadNFTs = loadNFTs;
