export interface PhProvince {
  name: string;
  lat: number;
  lng: number;
}

// Philippine provinces with approximate capital/seat coordinates, used to rank
// how close an epicenter is to inhabited areas on the /details page.
export const PH_PROVINCES: PhProvince[] = [
  // NCR
  { name: 'Metro Manila', lat: 14.5995, lng: 120.9842 },
  // Cordillera
  { name: 'Abra', lat: 17.5953, lng: 120.6181 },
  { name: 'Apayao', lat: 17.0175, lng: 121.1833 },
  { name: 'Benguet', lat: 16.4555, lng: 120.5873 },
  { name: 'Ifugao', lat: 16.7997, lng: 121.1175 },
  { name: 'Kalinga', lat: 17.4084, lng: 121.4444 },
  { name: 'Mountain Province', lat: 17.0911, lng: 120.9781 },
  // Ilocos
  { name: 'Ilocos Norte', lat: 18.1951, lng: 120.5935 },
  { name: 'Ilocos Sur', lat: 17.5733, lng: 120.3894 },
  { name: 'La Union', lat: 16.6167, lng: 120.3167 },
  { name: 'Pangasinan', lat: 16.0161, lng: 120.2323 },
  // Cagayan Valley
  { name: 'Batanes', lat: 20.4513, lng: 121.9702 },
  { name: 'Cagayan', lat: 17.6135, lng: 121.7263 },
  { name: 'Isabela', lat: 17.1481, lng: 121.8893 },
  { name: 'Nueva Vizcaya', lat: 16.4833, lng: 121.15 },
  { name: 'Quirino', lat: 16.5104, lng: 121.5225 },
  // Central Luzon
  { name: 'Aurora', lat: 15.7581, lng: 121.5625 },
  { name: 'Bataan', lat: 14.6765, lng: 120.5317 },
  { name: 'Bulacan', lat: 14.8441, lng: 120.8114 },
  { name: 'Nueva Ecija', lat: 15.542, lng: 121.0842 },
  { name: 'Pampanga', lat: 15.0306, lng: 120.6899 },
  { name: 'Tarlac', lat: 15.4802, lng: 120.5971 },
  { name: 'Zambales', lat: 15.3261, lng: 119.9793 },
  // Calabarzon
  { name: 'Batangas', lat: 13.7565, lng: 121.0583 },
  { name: 'Cavite', lat: 14.2074, lng: 120.9369 },
  { name: 'Laguna', lat: 14.2824, lng: 121.4155 },
  { name: 'Quezon', lat: 13.9342, lng: 121.6174 },
  { name: 'Rizal', lat: 14.5865, lng: 121.1766 },
  // Mimaropa
  { name: 'Marinduque', lat: 13.447, lng: 121.8423 },
  { name: 'Occidental Mindoro', lat: 13.2181, lng: 120.5963 },
  { name: 'Oriental Mindoro', lat: 13.4104, lng: 121.1805 },
  { name: 'Palawan', lat: 9.7401, lng: 118.7303 },
  { name: 'Romblon', lat: 12.5752, lng: 122.2742 },
  // Bicol
  { name: 'Albay', lat: 13.1391, lng: 123.7438 },
  { name: 'Camarines Norte', lat: 14.1145, lng: 122.9562 },
  { name: 'Camarines Sur', lat: 13.5532, lng: 123.2722 },
  { name: 'Catanduanes', lat: 13.5848, lng: 124.2344 },
  { name: 'Masbate', lat: 12.3714, lng: 123.6247 },
  { name: 'Sorsogon', lat: 12.9744, lng: 123.9947 },
  // Western Visayas
  { name: 'Aklan', lat: 11.7082, lng: 122.3643 },
  { name: 'Antique', lat: 10.7431, lng: 121.9411 },
  { name: 'Capiz', lat: 11.5852, lng: 122.7512 },
  { name: 'Guimaras', lat: 10.6599, lng: 122.5921 },
  { name: 'Iloilo', lat: 10.7202, lng: 122.5621 },
  { name: 'Negros Occidental', lat: 10.6705, lng: 122.9864 },
  { name: 'Negros Oriental', lat: 9.3071, lng: 123.3072 },
  // Central Visayas
  { name: 'Bohol', lat: 9.6502, lng: 123.8559 },
  { name: 'Cebu', lat: 10.3157, lng: 123.8916 },
  { name: 'Siquijor', lat: 9.2141, lng: 123.5144 },
  // Eastern Visayas
  { name: 'Biliran', lat: 11.5832, lng: 124.4665 },
  { name: 'Eastern Samar', lat: 11.6083, lng: 125.4322 },
  { name: 'Leyte', lat: 11.2433, lng: 125.0049 },
  { name: 'Northern Samar', lat: 12.4493, lng: 124.6372 },
  { name: 'Samar', lat: 11.7753, lng: 124.8858 },
  { name: 'Southern Leyte', lat: 10.1331, lng: 124.8443 },
  // Zamboanga Peninsula
  { name: 'Zamboanga del Norte', lat: 8.5873, lng: 123.3403 },
  { name: 'Zamboanga del Sur', lat: 7.8254, lng: 123.4361 },
  { name: 'Zamboanga Sibugay', lat: 7.7844, lng: 122.5828 },
  // Bangsamoro
  { name: 'Basilan', lat: 6.7039, lng: 122.1487 },
  { name: 'Sulu', lat: 6.0528, lng: 121.0019 },
  { name: 'Tawi-Tawi', lat: 5.0292, lng: 119.7734 },
  { name: 'Lanao del Sur', lat: 7.9984, lng: 124.2937 },
  // Northern Mindanao
  { name: 'Bukidnon', lat: 8.1575, lng: 125.1282 },
  { name: 'Camiguin', lat: 9.2527, lng: 124.7162 },
  { name: 'Lanao del Norte', lat: 8.0551, lng: 123.7904 },
  { name: 'Misamis Occidental', lat: 8.4859, lng: 123.8055 },
  { name: 'Misamis Oriental', lat: 8.4542, lng: 124.6319 },
  // Davao
  { name: 'Davao de Oro', lat: 7.6, lng: 125.9673 },
  { name: 'Davao del Norte', lat: 7.4483, lng: 125.8077 },
  { name: 'Davao del Sur', lat: 6.7564, lng: 125.3575 },
  { name: 'Davao Occidental', lat: 6.4119, lng: 125.6118 },
  { name: 'Davao Oriental', lat: 6.9483, lng: 126.2182 },
  // Soccsksargen
  { name: 'Cotabato', lat: 7.008, lng: 125.0894 },
  { name: 'Sarangani', lat: 6.1021, lng: 125.2905 },
  { name: 'South Cotabato', lat: 6.4996, lng: 124.8506 },
  { name: 'Sultan Kudarat', lat: 6.6299, lng: 124.6053 },
  // Caraga
  { name: 'Agusan del Norte', lat: 9.1233, lng: 125.5347 },
  { name: 'Agusan del Sur', lat: 8.6065, lng: 125.9155 },
  { name: 'Surigao del Norte', lat: 9.783, lng: 125.4952 },
  { name: 'Surigao del Sur', lat: 9.0793, lng: 126.1985 },
  { name: 'Dinagat Islands', lat: 10.0129, lng: 125.5941 },
];

// Major city seats worth surfacing on their own (covers NCR & high-population hubs).
export const PH_CITIES: PhProvince[] = [
  { name: 'Baguio City', lat: 16.4023, lng: 120.596 },
  { name: 'Tagaytay City', lat: 14.1032, lng: 120.9621 },
  { name: 'Naga City', lat: 13.625, lng: 123.1861 },
  { name: 'Davao City', lat: 7.1907, lng: 125.4553 },
  { name: 'General Santos City', lat: 6.1105, lng: 125.1724 },
  { name: 'Zamboanga City', lat: 6.9214, lng: 122.079 },
  { name: 'Butuan City', lat: 8.9475, lng: 125.5406 },
  { name: 'Olongapo City', lat: 14.8295, lng: 120.2832 },
  { name: 'Lucena City', lat: 13.9342, lng: 121.6174 },
];
